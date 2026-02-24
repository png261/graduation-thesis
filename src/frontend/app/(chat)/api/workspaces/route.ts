import { auth } from "@/app/(auth)/auth";
import { createWorkspace, getWorkspacesByUserId } from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";
import { postWorkspaceSchema } from "./schema";

export async function GET() {
    const session = await auth();

    if (!session?.user || !session.user.id) {
        return new ChatSDKError("unauthorized:chat").toResponse();
    }

    try {
        const workspaces = await getWorkspacesByUserId({ userId: session.user.id });

        if (workspaces.length === 0) {
            const [playground] = await createWorkspace({
                name: "Playground",
                userId: session.user.id,
            });

            // Initialize Git repo with README.md matching workspace name
            const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
            try {
                await fetch(`${BACKEND_URL}/project/${playground.id}/files`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        chatId: playground.id,
                        files: {
                            "README.md": `# Playground\n\nThis is your default infrastructure workspace.`
                        }
                    }),
                });
                await fetch(`${BACKEND_URL}/project/${playground.id}/git/init`, {
                    method: "POST",
                });
            } catch (e) {
                console.error("Failed to init git repo for playground workspace:", e);
            }
            return Response.json([playground], { status: 200 });
        }

        return Response.json(workspaces, { status: 200 });
    } catch (error) {
        console.error("GET /api/workspaces error:", error);
        return new ChatSDKError("bad_request:api").toResponse();
    }
}

export async function POST(request: Request) {
    const session = await auth();

    if (!session?.user || !session.user.id) {
        return new ChatSDKError("unauthorized:chat").toResponse();
    }

    try {
        const json = await request.json();
        const { name } = postWorkspaceSchema.parse(json);

        const [newWorkspace] = await createWorkspace({
            name,
            userId: session.user.id,
        });

        // Initialize Git repo with README.md matching workspace name
        const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
        try {
            await fetch(`${BACKEND_URL}/project/${newWorkspace.id}/files`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chatId: newWorkspace.id,
                    files: {
                        "README.md": `# ${name}\n\nThis is a newly created infrastructure workspace.`
                    }
                }),
            });
            await fetch(`${BACKEND_URL}/project/${newWorkspace.id}/git/init`, {
                method: "POST",
            });
        } catch (e) {
            console.error("Failed to init git repo for new workspace:", e);
        }

        return Response.json(newWorkspace, { status: 201 });
    } catch (error) {
        console.error("POST /api/workspaces error:", error);
        return new ChatSDKError("bad_request:api").toResponse();
    }
}
