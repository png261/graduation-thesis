import { generateText, stepCountIs, streamObject, streamText, tool } from "ai";
import { z } from "zod";
import {
  terraformFileContentPrompt,
  updateTerraformPrompt,
} from "@/lib/ai/prompts";
import { getEditorModel } from "@/lib/ai/providers";
import { createDocumentHandler } from "@/lib/editor/server";

export const terraformDocumentHandler = createDocumentHandler<"terraform">({
  kind: "terraform",
  onCreateDocument: async ({ id, title, description, dataStream, workspaceId }) => {
    const currentFiles: Record<string, string> = { "main.tf": "" };
    let fileTitles: string[] = ["main.tf"];

    console.log(`[Terraform] onCreateDocument started for: ${title}${description ? ` - ${description}` : ""}`);

    const broadcast = () => {
      const jsonString = JSON.stringify({
        files: fileTitles.map((t) => ({
          title: t,
          content: currentFiles[t] || "",
        })),
      });
      dataStream.write({
        type: "data-terraformDelta",
        data: jsonString,
        transient: true,
      });
      return jsonString;
    };
    // Send initial state immediately
    broadcast();

    // Define tools for the agentic loop
    const tools = {
      initialize_project: tool({
        description: "Initialize the project with a list of filenames.",
        inputSchema: z.object({
          files: z
            .array(z.string())
            .describe(
              "List of filenames to create (e.g. ['main.tf', 'variables.tf'])"
            ),
        }),
        execute: async (args: any) => {
          const { files } = args;
          console.log(
            `[Terraform] Tool: initialize_project called with: ${files.join(", ")}`
          );
          fileTitles = files;
          files.forEach((f: string) => {
            if (!currentFiles[f]) currentFiles[f] = "Pending...";
          });
          broadcast();
          return `Project initialized with files: ${files.join(", ")}. Now please provide the content for all files using write_project_files.`;
        },
      }),
      write_file: tool({
        description:
          "Write or stream the content for a specific file. Use this for single file updates.",
        inputSchema: z.object({
          filename: z.string().describe("The name of the file to write to."),
        }),
        execute: async (args: any) => {
          const { filename } = args;
          console.log(
            `[Terraform] Agent tool: writing content for ${filename}`
          );
          if (currentFiles[filename] === "Pending...")
            currentFiles[filename] = "";

          const { textStream } = streamText({
            model: getEditorModel(),
            system: terraformFileContentPrompt(
              filename,
              fileTitles,
              description || title,
              currentFiles
            ),
            prompt: `Generate complete HCL for ${filename}`,
          });

          for await (const delta of textStream) {
            currentFiles[filename] += delta;
            broadcast();
          }
          return `Successfully wrote content for ${filename}.`;
        },
      }),
      write_project_files: tool({
        description:
          "Write content for multiple files sequentially. RECOMMENDED for initial project generation to ensure smooth flow.",
        inputSchema: z.object({
          filenames: z
            .array(z.string())
            .describe("List of filenames to write sequentially."),
        }),
        execute: async (args: any) => {
          const { filenames } = args;
          console.log(
            `[Terraform] Agent tool: write_project_files called for: ${filenames.join(", ")}`
          );

          for (const filename of filenames) {
            console.log(`[Terraform] Sequential streaming: ${filename}`);
            if (
              !currentFiles[filename] ||
              currentFiles[filename] === "Pending..."
            ) {
              currentFiles[filename] = "";
            }
            broadcast(); // Update UI to show we started this file

            const { textStream } = streamText({
              model: getEditorModel(),
              system: terraformFileContentPrompt(
                filename,
                fileTitles,
                description || title,
                currentFiles
              ),
              prompt: `Generate complete HCL for ${filename}`,
            });

            let chunk = "";
            for await (const delta of textStream) {
              currentFiles[filename] += delta;
              chunk += delta;

              // Broadcast in chunks/throttle for smooth visualization if needed
              if (chunk.length > 50) {
                broadcast();
                chunk = "";
                // Optional: Small sleep to prevent browser overload during very fast streaming
                await new Promise((r) => setTimeout(r, 20));
              }
            }
            broadcast(); // Final broadcast for this file
          }
          return `Successfully wrote content for: ${filenames.join(", ")}`;
        },
      }),
      fetchFiles: tool({
        description: "Fetch the content of specific files from the project.",
        inputSchema: z.object({
          files: z.array(z.string()).describe("List of filenames to fetch."),
          version: z.string().optional().describe("Optional semantic version."),
        }),
        execute: async (args: any) => {
          const { files } = args;
          console.log(
            `[Terraform] Tool: fetchFiles called with: ${files.join(", ")}`
          );
          const result = files.map((f: string) => ({
            file: f,
            content: currentFiles[f] || "FILE_NOT_FOUND",
          }));
          return JSON.stringify(result);
        },
      }),
      fetchModules: tool({
        description: "Fetch Terraform module schema and metadata (READ-ONLY).",
        inputSchema: z.object({
          modules: z.array(
            z.object({
              registry_host: z.string(),
              module_namespace: z.string(),
              module_name: z.string(),
              module_provider: z.string(),
              module_version: z.string(),
              sub_module_path: z.string().optional(),
            })
          ),
        }),
        execute: async (args: any) => {
          console.log("[Terraform] Tool: fetchModules called");
          // Mock implementation
          return JSON.stringify({
            status: "success",
            message: "Modules fetched successfully (MOCK)",
          });
        },
      }),
      fetchPublicModuleDocs: tool({
        description: "Fetch documentation for public Terraform modules.",
        inputSchema: z.object({
          modules: z
            .array(z.string())
            .describe(
              "List of module IDs (hostname/namespace/name/provider/version)"
            ),
        }),
        execute: async (args: any) => {
          console.log("[Terraform] Tool: fetchPublicModuleDocs called");
          // Mock implementation
          return JSON.stringify({
            status: "success",
            message: "Module docs fetched successfully (MOCK)",
          });
        },
      }),
      edit: tool({
        description: "Perform a string replacement in a file.",
        inputSchema: z.object({
          filePath: z
            .string()
            .describe(
              "Absolute path to file (or just filename in this context)."
            ),
          oldString: z.string().describe("The exact string to replace."),
          newString: z.string().describe("The new string."),
          replaceAll: z
            .boolean()
            .optional()
            .describe("Replace all occurrences."),
        }),
        execute: async (args: any) => {
          const { filePath, oldString, newString, replaceAll } = args;
          console.log(`[Terraform] Tool: edit called for ${filePath}`);

          if (!currentFiles[filePath]) {
            return `Error: File ${filePath} not found.`;
          }

          if (!currentFiles[filePath].includes(oldString)) {
            return `Error: String not found in ${filePath}.`;
          }

          // Apply the replacement
          const oldContent = currentFiles[filePath];
          let newContent: string;
          if (replaceAll) {
            newContent = oldContent.split(oldString).join(newString);
          } else {
            newContent = oldContent.replace(oldString, newString);
          }

          // Stream the new content for visual effect
          currentFiles[filePath] = "";
          broadcast();

          for (let i = 0; i < newContent.length; i++) {
            currentFiles[filePath] += newContent[i];
            if (i % 50 === 0 || i === newContent.length - 1) {
              broadcast();
            }
          }

          return `Successfully edited ${filePath}. Replaced ${replaceAll ? "all occurrences" : "1 occurrence"}.`;
        },
      }),
      multiEdit: tool({
        description: "Perform multiple edits to a single file.",
        inputSchema: z.object({
          filePath: z.string(),
          edits: z.array(
            z.object({
              oldString: z.string(),
              newString: z.string(),
              replaceAll: z.boolean().optional(),
            })
          ),
        }),
        execute: async (args: any) => {
          const { filePath, edits } = args;
          console.log(
            `[Terraform] Tool: multiEdit called for ${filePath} with ${edits.length} edits`
          );

          if (!currentFiles[filePath]) {
            return `Error: File ${filePath} not found.`;
          }

          let editCount = 0;
          for (const edit of edits) {
            const { oldString, newString, replaceAll } = edit;
            if (currentFiles[filePath].includes(oldString)) {
              const oldContent = currentFiles[filePath];
              let updatedContent: string;
              if (replaceAll) {
                updatedContent = oldContent.split(oldString).join(newString);
              } else {
                updatedContent = oldContent.replace(oldString, newString);
              }

              // Stream the updated content for this specific edit
              currentFiles[filePath] = "";
              broadcast();

              for (let i = 0; i < updatedContent.length; i++) {
                currentFiles[filePath] += updatedContent[i];
                if (i % 50 === 0 || i === updatedContent.length - 1) {
                  broadcast();
                }
              }
              editCount++;
            } else {
              console.log(
                `[Terraform] multiEdit warning: String not found: ${oldString.substring(0, 20)}...`
              );
            }
          }
          return `Successfully applied ${editCount} out of ${edits.length} edits to ${filePath}.`;
        },
      }),
    };
    // Use SDK's built-in tool loop with maxSteps
    try {
      console.log(
        `[Terraform] Starting generation with maxSteps for: ${title}`
      );
      console.log(`[Terraform] Model: ${getEditorModel().modelId}`);

      const result = await generateText({
        model: getEditorModel(),
        system: `You are a Terraform code generator. You MUST follow this exact 3-step workflow for every project:

STEP 1: Call initialize_project.
   - You MUST follow a fixed directory structure: 'modules/', 'live/', and 'global/'.
   - You MUST include 'plan.md' and 'README.md' in the file list.
   - Include all other required .tf files.

STEP 2: Call write_file for 'plan.md'.
   - This file MUST contain a detailed implementation plan, architecture overview, and resource breakdown.
   - You MUST do this BEFORE generating any other code.

STEP 3: Call write_project_files for the remaining files.
   - Include 'README.md' and all .tf files.
   - 'README.md' should explain how to use the infrastructure.

ORGANIZATION RULES:
- Use the mandated directory structure: 'modules/', 'live/', 'global/'.
- Use forward slashes ('/') in filenames.
- Keep the root directory clean; except for 'plan.md' and 'README.md'.

CRITICAL RULES:
- NEVER skip the 'plan.md' step. It is your design phase.
- EVERY project MUST have a 'README.md'.
- DO NOT generate any text responses - ONLY use tool calls.
- Each file MUST contain complete, valid content (Markdown for .md, HCL for .tf).`,
        prompt: `Plan and generate the following Terraform project: ${title}${description ? `\n\nUser Requirements:\n${description}` : ""}`,
        tools,
        toolChoice: "required", // Force tool usage to prevent premature termination
        stopWhen: stepCountIs(15),
        onStepFinish: (step) => {
          console.log(`[Terraform] Step: ${step.finishReason}`);
          if (step.toolCalls) {
            console.log(
              `[Terraform] Tools called: ${step.toolCalls.map((tc) => tc.toolName).join(", ")}`
            );
          }
          if (step.toolResults) {
            console.log(
              `[Terraform] Tool results: ${step.toolResults.length} results`
            );
          }
        },
      });

      console.log(
        `[Terraform] Generation completed. Reason: ${result.finishReason}`
      );
      console.log(`[Terraform] Steps used: ${result.steps?.length || 0}`);
      console.log(
        `[Terraform] Tool calls in result: ${result.toolCalls?.length || 0}`
      );
      console.log(
        `[Terraform] Tool results in result: ${result.toolResults?.length || 0}`
      );
      console.log(
        `[Terraform] Response modes in result: ${result.steps?.map((s) => s.finishReason).join(", ")}`
      );
    } catch (error) {
      console.error("[Terraform] CRITICAL ERROR in generation:", error);
    }

    // After all AI generation tools have finished running, we need to
    // explicitly write the resulting files to the Python backend so they are available
    // for git tracking, execution, and restoring from database.
    try {
      const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
      // We use the document ID (chat ID) to uniquely identify the workspace repo for these files
      const chatId = id;

      const filesPayload = fileTitles.reduce((acc, curr) => {
        acc[curr] = currentFiles[curr] || "";
        return acc;
      }, {} as Record<string, string>);

      await fetch(`${BACKEND_URL}/project/${chatId}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: chatId,
          files: filesPayload,
          commitMessage: "Auto-commit: AI Initialization"
        })
      });

      console.log(`[Terraform] Successfully synced ${fileTitles.length} generated files to backend.`);
    } catch (e) {
      console.error("[Terraform] Failed to sync generated files to backend:", e);
    }

    return broadcast();
  },
  onUpdateDocument: async ({ document, description, dataStream }) => {
    let draftContent = document.content;

    const { fullStream } = streamObject({
      model: getEditorModel(),
      system: updateTerraformPrompt(document.content),
      prompt: description,
      schema: z.object({
        files: z.array(
          z.object({
            title: z.string(),
            content: z.string(),
          })
        ),
      }),
    });

    for await (const delta of fullStream) {
      const { type } = delta;

      if (type === "object") {
        const { object } = delta;

        if (object) {
          const jsonString = JSON.stringify(object);
          dataStream.write({
            type: "data-terraformDelta",
            data: jsonString,
            transient: true,
          });
          draftContent = jsonString;
        }
      }
    }

    return draftContent || "";
  },
});
