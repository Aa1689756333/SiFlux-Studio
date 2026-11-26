import { resolveAddNodeMenuCommands, type AddNodeMenuContext } from "@/lib/canvas/tool-registry";

import type { CanvasCreateCommand } from "./canvas-create-menu";

export function useCanvasCreateCommands(context: AddNodeMenuContext, runCommand?: (command: () => void) => void): CanvasCreateCommand[] {
    return resolveAddNodeMenuCommands(context).map((command) => ({
        id: command.id,
        label: command.label,
        icon: command.icon,
        section: command.section,
        onClick: () => {
            const run = () => command.run(context);
            if (runCommand) runCommand(run);
            else run();
        },
    }));
}
