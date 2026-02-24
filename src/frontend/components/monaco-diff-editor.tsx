"use client";

import { useRef, useEffect } from "react";
import { DiffEditor, useMonaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";

interface MonacoDiffEditorProps {
    originalContent: string;
    modifiedContent: string;
    language?: string;
    className?: string;
}

export function MonacoDiffEditor({
    originalContent,
    modifiedContent,
    language = "hcl",
    className,
}: MonacoDiffEditorProps) {
    const monaco = useMonaco();
    const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null);

    useEffect(() => {
        if (monaco) {
            // Basic terraform syntax highlighting if needed
            monaco.languages.register({ id: "hcl" });
        }
    }, [monaco]);

    const handleEditorDidMount = (editor: editor.IStandaloneDiffEditor) => {
        diffEditorRef.current = editor;
    };

    return (
        <div className={`w-full h-full relative ${className || ""}`}>
            <DiffEditor
                height="100%"
                language={language}
                original={originalContent}
                modified={modifiedContent}
                theme="vs-dark"
                options={{
                    renderSideBySide: false, // Unified diff view
                    readOnly: true,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    wordWrap: "on",
                    lineNumbersMinChars: 4,
                    fontSize: 13,
                    fontFamily: "var(--font-mono)",
                    ignoreTrimWhitespace: false,
                    renderIndicators: true, // Show +/- indicators
                }}
                onMount={handleEditorDidMount}
                loading={
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                        Loading Diff Editor...
                    </div>
                }
            />
        </div>
    );
}
