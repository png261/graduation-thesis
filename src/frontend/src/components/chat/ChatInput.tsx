"use client"

import { ChangeEvent, ClipboardEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { BorderBeam } from "@/components/ui/border-beam"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Database, FileText, Github, ImageIcon, Paperclip, Send, Square, X } from "lucide-react"
import type { ChatAttachment, UserHandoff } from "./types"
import type { SelectedRepository, SelectedStateBackend } from "@/lib/agentcore-client/types"

export const NO_REPOSITORY_VALUE = "__no_repository__"
export const NO_STATE_BACKEND_VALUE = "__no_state_backend__"
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024
const MAX_ATTACHMENTS = 6
const CHAT_INPUT_MAX_HEIGHT = 200

interface ChatInputProps {
  input: string
  setInput: (input: string) => void
  handleSubmit: (e: FormEvent) => void
  isLoading: boolean
  onStop?: () => void
  disabled?: boolean
  className?: string
  compactControls?: boolean
  attachments?: ChatAttachment[]
  onAttachmentsChange?: (attachments: ChatAttachment[]) => void
  repositories?: SelectedRepository[]
  selectedRepositoryFullName?: string
  onRepositoryChange?: (fullName: string) => void
  repositoryLocked?: boolean
  isLoadingRepositories?: boolean
  repositoryError?: string | null
  stateBackends?: SelectedStateBackend[]
  selectedStateBackendId?: string
  onStateBackendChange?: (backendId: string) => void
  isLoadingStateBackends?: boolean
  stateBackendError?: string | null
  userHandoff?: UserHandoff | null
  onUserHandoffSubmit?: (answers: string) => void
}

export function ChatInput({
  input,
  setInput,
  handleSubmit,
  isLoading,
  onStop,
  disabled = false,
  className = "",
  compactControls = false,
  attachments = [],
  onAttachmentsChange,
  repositories = [],
  selectedRepositoryFullName = NO_REPOSITORY_VALUE,
  onRepositoryChange,
  repositoryLocked = false,
  isLoadingRepositories = false,
  repositoryError = null,
  stateBackends = [],
  selectedStateBackendId = NO_STATE_BACKEND_VALUE,
  onStateBackendChange,
  isLoadingStateBackends = false,
  stateBackendError = null,
  userHandoff = null,
  onUserHandoffSubmit,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [handoffAnswers, setHandoffAnswers] = useState<Record<string, string>>({})
  const [activeHandoffIndex, setActiveHandoffIndex] = useState(0)

  // Auto-resize the textarea based on content
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = "auto"
      const scrollHeight = textarea.scrollHeight
      const nextHeight = Math.min(scrollHeight, CHAT_INPUT_MAX_HEIGHT)
      textarea.style.height = nextHeight + "px"
      textarea.style.overflowY = scrollHeight > CHAT_INPUT_MAX_HEIGHT ? "auto" : "hidden"
    }
  }, [input])

  useEffect(() => {
    setHandoffAnswers({})
    setActiveHandoffIndex(0)
  }, [userHandoff])

  const readFileAsAttachment = (file: File) =>
    new Promise<ChatAttachment>((resolve, reject) => {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        reject(new Error(`${file.name} is larger than 4 MB`))
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        resolve({
          id: crypto.randomUUID(),
          name: file.name || (file.type.startsWith("image/") ? "pasted-image.png" : "attachment"),
          type: file.type || "application/octet-stream",
          size: file.size,
          dataUrl: String(reader.result),
        })
      }
      reader.onerror = () => reject(new Error(`Failed to read ${file.name || "attachment"}`))
      reader.readAsDataURL(file)
    })

  const addFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList)
    if (files.length === 0 || !onAttachmentsChange) return
    setAttachmentError(null)
    const remainingSlots = MAX_ATTACHMENTS - attachments.length
    if (remainingSlots <= 0) {
      setAttachmentError(`Attach up to ${MAX_ATTACHMENTS} files per message`)
      return
    }
    try {
      const nextAttachments = await Promise.all(files.slice(0, remainingSlots).map(readFileAsAttachment))
      onAttachmentsChange([...attachments, ...nextAttachments])
      if (files.length > remainingSlots) {
        setAttachmentError(`Only ${MAX_ATTACHMENTS} files can be attached per message`)
      }
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "Failed to attach file")
    }
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) void addFiles(event.target.files)
    event.target.value = ""
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith("image/"))
    if (files.length === 0) return
    event.preventDefault()
    void addFiles(files)
  }

  const removeAttachment = (attachmentId: string) => {
    onAttachmentsChange?.(attachments.filter(attachment => attachment.id !== attachmentId))
  }

  const canSubmit = input.trim().length > 0 || attachments.length > 0
  const handoffQuestions = userHandoff?.questions ?? []
  const activeHandoffQuestion = handoffQuestions[activeHandoffIndex]
  const activeHandoffAnswer = activeHandoffQuestion ? handoffAnswers[activeHandoffQuestion.id] ?? "" : ""
  const canAdvanceHandoff = activeHandoffAnswer.trim().length > 0
  const canSubmitHandoff =
    handoffQuestions.length > 0 &&
    handoffQuestions.every(question => (handoffAnswers[question.id] ?? "").trim().length > 0)
  const isLastHandoffQuestion = activeHandoffIndex >= handoffQuestions.length - 1

  const setHandoffAnswer = (questionId: string, answer: string) => {
    setHandoffAnswers(prev => ({ ...prev, [questionId]: answer }))
  }

  const advanceHandoffQuestion = () => {
    if (!canAdvanceHandoff) return
    setActiveHandoffIndex(index => Math.min(index + 1, handoffQuestions.length - 1))
  }

  const previousHandoffQuestion = () => {
    setActiveHandoffIndex(index => Math.max(index - 1, 0))
  }

  const submitHandoffAnswers = () => {
    if (!canSubmitHandoff) return
    const answerText = [
      "Here are my clarification answers:",
      ...handoffQuestions.map((question, index) => {
        const answer = (handoffAnswers[question.id] ?? "").trim()
        return `${index + 1}. ${question.question}\nAnswer: ${answer}`
      }),
    ].join("\n\n")
    onUserHandoffSubmit?.(answerText)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter") {
      if (e.ctrlKey) {
        // Add a new line when Ctrl+Enter is pressed
        setInput(`${input}\n\n`)
        e.preventDefault()
      } else if (!e.shiftKey) {
        // Submit the form when Enter is pressed without Shift
        if (!isLoading && canSubmit) {
          e.preventDefault()
          handleSubmit(e as unknown as FormEvent)
        }
      }
    }
  }

  return (
    <div className={`relative w-full bg-white p-4 ${className}`}>
      <form
        onSubmit={handleSubmit}
        aria-label="chat input"
        className="relative flex w-full flex-col gap-3 overflow-hidden rounded-[28px] border border-slate-200 bg-white px-4 py-3 shadow-[0_10px_35px_rgba(15,23,42,0.12)] focus-within:border-slate-300"
      >
        {isLoading && (
          <BorderBeam
            size={120}
            duration={8}
            borderWidth={1}
            colorFrom="#0f172a"
            colorTo="#38bdf8"
          />
        )}
        {handoffQuestions.length > 0 && activeHandoffQuestion && (
          <div className="relative z-10 rounded-2xl border border-sky-200 bg-sky-50 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-950">Clarification needed</p>
                <p className="text-xs text-slate-600">
                  Question {activeHandoffIndex + 1} of {handoffQuestions.length}. Choose an option or enter your own answer.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {handoffQuestions.length > 1 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={activeHandoffIndex === 0 || isLoading || disabled}
                    onClick={previousHandoffQuestion}
                    className="rounded-full border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  >
                    Back
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  disabled={(isLastHandoffQuestion ? !canSubmitHandoff : !canAdvanceHandoff) || isLoading || disabled}
                  onClick={isLastHandoffQuestion ? submitHandoffAnswers : advanceHandoffQuestion}
                  className="rounded-full border border-slate-950 bg-slate-950 text-white hover:bg-slate-800"
                >
                  {isLastHandoffQuestion ? "Send answers" : "Next question"}
                </Button>
              </div>
            </div>
            <div className="rounded-2xl border border-sky-100 bg-white p-3">
              <p className="text-sm font-medium text-slate-900">
                {activeHandoffIndex + 1}. {activeHandoffQuestion.question}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {activeHandoffQuestion.options.map(option => {
                  const isSelected = activeHandoffAnswer === option
                  return (
                    <button
                      key={option}
                      type="button"
                      disabled={isLoading || disabled}
                      onClick={() => setHandoffAnswer(activeHandoffQuestion.id, option)}
                      className={`rounded-md border px-3 py-1.5 text-left text-xs font-medium transition ${
                        isSelected
                          ? "border-slate-950 bg-slate-950 text-white"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      {option}
                    </button>
                  )
                })}
              </div>
              <input
                type="text"
                value={activeHandoffQuestion.options.includes(activeHandoffAnswer) ? "" : activeHandoffAnswer}
                onChange={event => setHandoffAnswer(activeHandoffQuestion.id, event.target.value)}
                placeholder="Custom answer"
                disabled={isLoading || disabled}
                className="mt-2 h-9 w-full rounded-full border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none placeholder:text-slate-400 focus:border-slate-400"
              />
            </div>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map(attachment => (
              <div
                key={attachment.id}
                className="flex max-w-[220px] items-center gap-2 rounded-xl border border-slate-200 bg-transparent px-2 py-1 text-xs text-slate-700"
              >
                {attachment.type.startsWith("image/") ? (
                  <ImageIcon className="h-4 w-4 shrink-0" />
                ) : (
                  <FileText className="h-4 w-4 shrink-0" />
                )}
                <span className="min-w-0 truncate rounded bg-slate-100 px-1.5 py-0.5">{attachment.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${attachment.name}`}
                  className="rounded p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-950"
                  onClick={() => removeAttachment(attachment.id)}
                  disabled={disabled}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={e => {
            setInput(e.target.value)
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Type your message..."
          disabled={disabled}
          className="min-h-[48px] max-h-[200px] w-full resize-none overflow-hidden border-0 bg-transparent px-0 py-2 text-[15px] leading-6 text-slate-950 shadow-none outline-none placeholder:text-slate-400 focus-visible:ring-0 focus-visible:ring-offset-0"
          rows={1}
          autoFocus
        />

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-transparent pt-0">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            <Button
              aria-label="Attach file"
              className="h-9 w-9 rounded-full border-slate-200 bg-white p-0 text-slate-700 shadow-none hover:bg-slate-50"
              disabled={disabled || attachments.length >= MAX_ATTACHMENTS}
              onClick={() => fileInputRef.current?.click()}
              type="button"
              variant="outline"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <Select
              value={selectedRepositoryFullName || NO_REPOSITORY_VALUE}
              onValueChange={onRepositoryChange}
              disabled={repositoryLocked || isLoadingRepositories || disabled}
            >
              <SelectTrigger
                aria-label="GitHub repository"
                className={`h-9 rounded-full border-slate-200 bg-white text-slate-700 shadow-none ${
                  compactControls ? "w-9 justify-center px-0" : "max-w-[240px] min-w-[170px] px-3"
                }`}
                size="sm"
                title={selectedRepositoryFullName && selectedRepositoryFullName !== NO_REPOSITORY_VALUE ? selectedRepositoryFullName : "No repository"}
              >
                <Github className="h-4 w-4" />
                {!compactControls && (
                  <SelectValue
                    placeholder={isLoadingRepositories ? "Loading repositories..." : "Select repository"}
                  />
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={NO_REPOSITORY_VALUE}>No repository</SelectItem>
                  {repositories.map(repo => (
                    <SelectItem key={repo.fullName} value={repo.fullName}>
                      {repo.fullName}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              value={selectedStateBackendId || NO_STATE_BACKEND_VALUE}
              onValueChange={onStateBackendChange}
              disabled={isLoadingStateBackends || disabled}
            >
              <SelectTrigger
                aria-label="Terraform state backend"
                className={`h-9 rounded-full border-slate-200 bg-white text-slate-700 shadow-none ${
                  compactControls ? "w-9 justify-center px-0" : "max-w-[240px] min-w-[170px] px-3"
                }`}
                size="sm"
                title={selectedStateBackendId && selectedStateBackendId !== NO_STATE_BACKEND_VALUE ? selectedStateBackendId : "No state backend"}
              >
                <Database className="h-4 w-4" />
                {!compactControls && (
                  <SelectValue
                    placeholder={isLoadingStateBackends ? "Loading states..." : "Select state"}
                  />
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={NO_STATE_BACKEND_VALUE}>No state backend</SelectItem>
                  {stateBackends.map(backend => (
                    <SelectItem key={backend.backendId} value={backend.backendId}>
                      {backend.name} ({backend.region})
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {repositoryError && (
              <span className="text-xs font-medium text-red-600">{repositoryError}</span>
            )}
            {stateBackendError && (
              <span className="text-xs font-medium text-red-600">{stateBackendError}</span>
            )}
            {attachmentError && (
              <span className="text-xs font-medium text-red-600">{attachmentError}</span>
            )}
          </div>
          <Button
            type={isLoading ? "button" : "submit"}
            aria-label={isLoading ? "Stop response" : "Send message"}
            title={isLoading ? "Stop response" : "Send message"}
            disabled={isLoading ? disabled : !canSubmit || disabled}
            className={`h-9 w-9 rounded-full border p-0 text-white shadow-none ${
              isLoading
                ? "border-red-600 bg-red-600 hover:bg-red-700"
                : "border-slate-950 bg-slate-950 hover:bg-slate-800"
            }`}
            onClick={isLoading ? onStop : undefined}
          >
            {isLoading ? (
              <Square className="h-4 w-4 fill-current" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
