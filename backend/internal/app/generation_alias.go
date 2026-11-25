package app

import "infinite-canvas/backend/internal/generation"

type canvasGenerationInput = generation.Input
type canvasTextOptions = generation.TextOptions
type agentToolRequests = generation.AgentToolRequests
type canonicalAgentRequest = generation.CanonicalAgentRequest
type providerTextMessage = generation.TextMessage
type providerConfig = generation.Config
type providerMedia = generation.Media
type WorkflowField = generation.WorkflowField
type imageResponse = generation.ImageResponse
type providerError = generation.UpstreamError
type providerPayloadError = generation.PayloadError
type providerHTTPError = generation.HTTPError
type providerResponseDecodeError = generation.ResponseDecodeError
type providerCircuitOpenError = generation.CircuitOpenError
type providerStatePendingError = generation.StatePendingError
type providerSubmissionUnknownError = generation.SubmissionUnknownError
type providerRequestNotSentError = generation.RequestNotSentError
type providerMediaHydrationPolicy = generation.MediaHydrationPolicy

const providerHTTPTimeout = generation.HTTPTimeout
const providerPollTimeout = generation.PollingTimeout
const maxProviderResponseBytes = generation.MaxResponseBytes

const defaultProviderPollInterval = generation.DefaultPollInterval

const jiMengSubmitAction = generation.JiMengSubmitAction
const jiMengResultAction = generation.JiMengResultAction
const volcengineArkImageMinPixels = generation.VolcengineArkImageMinPixels
const volcengineArkImageMaxPixels = generation.VolcengineArkImageMaxPixels
