package bootstrap

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/assistantruntime"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/eagle"
	canvasHandler "infinite-canvas/backend/internal/handler"
	"infinite-canvas/backend/internal/localapp"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/runtimeinfo"
	httptransport "infinite-canvas/backend/internal/transport/http"
	"infinite-canvas/backend/internal/workspace"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/agentops"
)

type Runtime struct {
	workspaceLock    *os.File
	cfg              Config
	db               *gorm.DB
	service          *app.Service
	localApp         *localapp.App
	handler          http.Handler
	status           *systemStatus
	launchToken      string
	uiBootstrapToken string
	assistantHost    *assistantruntime.Host
	listener         net.Listener
	httpServer       *http.Server
	serveErr         chan error
	started          atomic.Bool
	closed           atomic.Bool
	closeOnce        sync.Once
	background       sync.WaitGroup
	closeErr         error
}

func Open(_ context.Context, raw Config) (result *Runtime, openErr error) {
	cfg := raw.withDefaults()
	if cfg.Profile != ProfileServer && cfg.Profile != ProfileDesktop {
		return nil, fmt.Errorf("不支持的运行模式：%s", cfg.Profile)
	}
	if strings.TrimSpace(cfg.DataDir) == "" {
		return nil, errors.New("后端数据目录不能为空")
	}
	if cfg.Profile == ProfileDesktop && !strings.HasPrefix(cfg.ListenAddr, "127.0.0.1:") {
		return nil, errors.New("桌面运行时只能监听 127.0.0.1")
	}
	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		return nil, err
	}
	var workspaceLock *os.File
	if cfg.Profile == ProfileDesktop {
		var err error
		workspaceLock, err = runtimeinfo.LockWorkspace(cfg.DataDir)
		if err != nil {
			return nil, err
		}
		defer func() {
			if openErr != nil {
				_ = workspaceLock.Close()
			}
		}()
	}
	db, err := database.Open(database.Config{Driver: cfg.DatabaseDriver, DSN: cfg.DatabaseURL, DataDir: cfg.DataDir})
	if err != nil {
		return nil, err
	}
	cleanupDB := func() {
		if sqlDB, sqlErr := db.DB(); sqlErr == nil {
			_ = sqlDB.Close()
		}
	}
	if err := database.ConfigurePool(db); err != nil {
		cleanupDB()
		return nil, err
	}
	if cfg.AutoMigrate {
		err = database.MigrateLocalSchema(db)
	} else {
		err = database.RequireLocalSchema(db)
	}
	if err != nil {
		cleanupDB()
		return nil, err
	}

	repo := repository.New(db)
	svc := app.NewLocal(repo, cfg.DataDir)
	cleanupService := func() {
		_ = svc.Close()
		cleanupDB()
	}
	if err := initializeService(svc); err != nil {
		cleanupService()
		return nil, err
	}
	providerConfig, configErr := workspace.NewProviderConfig(cfg.DataDir)
	if configErr != nil {
		cleanupService()
		return nil, configErr
	}
	localKernel := app.NewLocalKernel(svc)
	assetService := svc.ResourceService()
	projectService := svc.ProjectService()
	taskService := svc.TaskService()
	localRoot, err := localapp.New(localapp.Options{
		Workspace: workspace.NewService(repo), Projects: projectService, Assets: assetService, Tasks: taskService,
		Generation: taskService, ProviderConfig: providerConfig, Lifecycle: localKernel,
	})
	if err != nil {
		cleanupService()
		return nil, err
	}

	owner, ownerErr := svc.LocalWorkspaceOwner()
	if ownerErr != nil {
		cleanupService()
		return nil, ownerErr
	}
	scope := workspace.Context{ID: owner.ID, DataDir: cfg.DataDir}

	// 桌面启动令牌在构建路由前解析：它既是整个 API 的入口凭据，也是「本机受信任 UI」
	// 的判据（内置助手签发 UI 会话时使用）。服务端形态没有它，DesktopTrust 为 nil。
	launchToken := ""
	uiBootstrapToken := ""
	if cfg.Profile == ProfileDesktop {
		uiBootstrapToken, err = httptransport.NewLaunchToken()
		if err != nil {
			cleanupService()
			return nil, err
		}
		launchToken = strings.TrimSpace(cfg.LaunchToken)
		if launchToken == "" {
			launchToken, err = httptransport.NewLaunchToken()
			if err != nil {
				cleanupService()
				return nil, err
			}
		}
	}

	router := gin.New()
	router.Use(gin.LoggerWithFormatter(func(param gin.LogFormatterParams) string {
		return fmt.Sprintf("%s - [%s] \"%s %s\" %d %s %s\n", param.ClientIP, param.TimeStamp.Format(time.RFC3339), param.Method, param.Path, param.StatusCode, param.Latency, param.ErrorMessage)
	}), gin.Recovery())
	router.Use(canvasHandler.RequestCorrelationMiddleware())
	for _, middleware := range cfg.RouterMiddleware {
		router.Use(middleware)
	}
	if cfg.Profile == ProfileDesktop {
		router.Use(desktopCORSMiddleware())
	}
	router.Use(canvasHandler.WorkspaceMiddleware(scope))
	// 本机可信凭据在组合根生成：owner 凭据与宿主凭据只在本机数据目录，0600。
	agentops.EnsureAgentCredentials(svc.DataDir())
	assistantHost := assistantruntime.New(assistantruntime.OptionsFromService(svc))
	api := router.Group("/api")
	// 日志中间件必须先注册，才能记录后续所有接口的访问。
	canvasHandler.RegisterLogRoutes(api, svc.DataDir())
	status := newSystemStatus(db, svc, true)
	registerSystemStatusRoutes(api, status)
	canvasHandler.RegisterDesktopCanvasAPIWithDependencies(api, svc, canvasHandler.RuntimeDependencies{
		RequestCoordinator: localKernel,
		ProviderConfig:     localRoot.ProviderConfig,
		Assets:             localRoot.Assets,
		Projects:           localRoot.Projects,
		Tasks:              localRoot.Tasks,
		Generation:         localRoot.Generation,
		AssistantHost:      assistantHost,
		Appearance:         svc.AppearanceDomain(),
		Diagnostics:        svc.DiagnosticsDomain(),
		Eagle:              eagle.New(),
		DesktopTrust:       desktopTrust(launchToken, uiBootstrapToken),
	})
	router.NoRoute(func(c *gin.Context) {
		c.JSON(http.StatusNotFound, gin.H{"code": http.StatusNotFound, "msg": "请求不存在"})
	})

	// 桌面形态的整张 API 只由启动令牌把关。owner 通道、内置宿主与 UI 会话都在各自
	// 路由内按凭据判定身份，不经过外层豁免。
	rootHandler := http.Handler(router)
	if launchToken != "" {
		rootHandler = httptransport.RequireLaunchToken(launchToken)(rootHandler)
	}
	return &Runtime{
		workspaceLock:    workspaceLock,
		cfg:              cfg,
		db:               db,
		service:          svc,
		localApp:         localRoot,
		handler:          rootHandler,
		status:           status,
		launchToken:      launchToken,
		uiBootstrapToken: uiBootstrapToken,
		assistantHost:    assistantHost,
		serveErr:         make(chan error, 1),
	}, nil
}

func initializeService(svc *app.Service) error {
	if err := svc.ValidateRuntime(); err != nil {
		return err
	}
	initializers := []func() error{
		svc.EnsureDefaultPromptTemplates,
		svc.EnsureBuiltinSkills,
		svc.EnsureSkillPackages,
	}
	for _, initialize := range initializers {
		if err := initialize(); err != nil {
			return err
		}
	}
	return nil
}

func (r *Runtime) Handler() http.Handler { return r.handler }

func (r *Runtime) Start() error {
	if r == nil || r.closed.Load() {
		return errors.New("运行时已关闭")
	}
	if !r.started.CompareAndSwap(false, true) {
		return nil
	}
	listener, err := net.Listen("tcp", r.cfg.ListenAddr)
	if err != nil {
		r.started.Store(false)
		return err
	}
	r.listener = listener
	r.httpServer = &http.Server{Handler: r.handler, ReadHeaderTimeout: 10 * time.Second}
	if r.localApp != nil {
		r.localApp.Start()
	} else {
		r.service.StartWorker()
	}
	// The assistant loads its operation catalog from this server before becoming
	// healthy. Accept requests before synchronously waiting for child readiness.
	go func() {
		err := r.httpServer.Serve(listener)
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			r.serveErr <- fmt.Errorf("HTTP 服务异常退出：%w", err)
		}
		close(r.serveErr)
	}()
	// 桌面形态：按本机配置拉起内置创作助手宿主（未配置时 no-op），
	// 关闭时由 Runtime.Close 收尾，保证「应用启动链」而不是手工点按钮。
	if r.cfg.Profile == ProfileDesktop {
		opsURL := "http://" + r.listener.Addr().String() + "/api"
		if r.assistantHost != nil {
			if err := r.assistantHost.Start(opsURL, r.launchToken); err != nil {
				log.Printf("内置创作助手宿主未启动（不影响应用启动）：%v", err)
			}
		}
	}
	r.status.markStarted()
	return nil
}

func (r *Runtime) Ready() bool {
	return r != nil && r.started.Load() && !r.closed.Load() && r.status.snapshot(context.Background()).Ready
}

func (r *Runtime) BaseURL() string {
	if r == nil || r.listener == nil {
		return ""
	}
	return "http://" + r.listener.Addr().String() + "/api"
}

func (r *Runtime) LaunchToken() string {
	if r == nil {
		return ""
	}
	return r.launchToken
}

func (r *Runtime) UIBootstrapToken() string { return r.uiBootstrapToken }

func (r *Runtime) Errors() <-chan error {
	if r == nil {
		closed := make(chan error)
		close(closed)
		return closed
	}
	return r.serveErr
}

func (r *Runtime) Close(ctx context.Context) error {
	if r == nil {
		return nil
	}
	r.closeOnce.Do(func() {
		r.closed.Store(true)
		r.status.beginDrain()
		var failures []error
		if r.httpServer != nil {
			httpCtx, cancel := context.WithTimeout(ctx, min(30*time.Second, r.cfg.ShutdownTimeout))
			if err := r.httpServer.Shutdown(httpCtx); err != nil {
				_ = r.httpServer.Close()
				failures = append(failures, fmt.Errorf("关闭 HTTP 服务：%w", err))
			}
			cancel()
		}
		workerCtx, cancel := context.WithTimeout(ctx, r.cfg.ShutdownTimeout)
		var workerErr error
		if r.localApp != nil {
			workerErr = r.localApp.Stop(workerCtx)
		} else {
			workerErr = r.service.StopWorker(workerCtx)
		}
		if workerErr != nil {
			failures = append(failures, fmt.Errorf("等待后台任务退出：%w", workerErr))
		}
		cancel()
		backgroundDone := make(chan struct{})
		go func() {
			r.background.Wait()
			close(backgroundDone)
		}()
		select {
		case <-backgroundDone:
		case <-ctx.Done():
			failures = append(failures, fmt.Errorf("等待初始化任务退出：%w", ctx.Err()))
		}
		// 本进程启动的内置宿主子进程必须跟着一起退出：否则后端重启后旧宿主会占着端口，
		// 让状态查询显示「可用」但其实是上一个进程的实例。只清理本进程启动过的 PID。
		if r.assistantHost != nil {
			if err := r.assistantHost.StopContext(ctx); err != nil {
				failures = append(failures, err)
			}
		}
		var serviceErr error
		if r.localApp != nil {
			serviceErr = r.localApp.Close()
		} else {
			serviceErr = r.service.Close()
		}
		if serviceErr != nil {
			failures = append(failures, serviceErr)
		}
		if sqlDB, err := r.db.DB(); err == nil {
			if err := sqlDB.Close(); err != nil {
				failures = append(failures, err)
			}
		}
		r.closeErr = errors.Join(failures...)
		if r.workspaceLock != nil {
			_ = r.workspaceLock.Close()
		}
	})
	return r.closeErr
}

func desktopCORSMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := strings.TrimSpace(c.GetHeader("Origin"))
		if origin != "" {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers")
		}
		c.Header("Access-Control-Allow-Headers", "Accept, Authorization, Content-Type, X-Desktop-Token, x-siflux-UI-Bootstrap, x-siflux-Ui-Session, X-Canvas-Trace-ID, X-Idempotency-Key, X-Canvas-Scene, X-Canvas-Upstream-URL, X-Canvas-Upstream-Format, X-Canvas-Upstream-Base-URL, X-Canvas-Upstream-Headers")
		c.Header("Access-Control-Expose-Headers", "X-Request-ID, X-Canvas-Trace-ID, X-Diagnostic-Bundle-ID, X-Diagnostic-Schema-Version")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

// desktopTrust 用桌面启动令牌判定请求是否来自受信任的桌面壳。
// 令牌为空（服务端形态）时返回 nil，表示没有这条信任路径。
func desktopTrust(launchToken, uiToken string) func(*http.Request) bool {
	want := []byte(strings.TrimSpace(launchToken))
	if len(want) == 0 {
		return nil
	}
	return func(r *http.Request) bool {
		got := []byte(r.Header.Get(httptransport.LaunchTokenHeader))
		ui := []byte(r.Header.Get("x-siflux-UI-Bootstrap"))
		return len(got) == len(want) && subtle.ConstantTimeCompare(got, want) == 1 && len(uiToken) > 0 && subtle.ConstantTimeCompare(ui, []byte(uiToken)) == 1
	}
}
