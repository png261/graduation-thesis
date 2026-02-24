import { z } from "zod";

export const postWorkspaceSchema = z.object({
    name: z.string().min(1).max(255),
});

export type PostWorkspaceBody = z.infer<typeof postWorkspaceSchema>;
