"use client"

import { ChangeEvent, ClipboardEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
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
import { Database, FileText, Github, Paperclip, Send, Square, X } from "lucide-react"
import type { ChatAgent, ChatAttachment, UserHandoff } from "./types"
import type { SelectedRepository, SelectedStateBackend } from "@/lib/agentcore-client/types"

export const NO_REPOSITORY_VALUE = "__no_repository__"
export const NO_STATE_BACKEND_VALUE = "__no_state_backend__"
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024
const MAX_ATTACHMENTS = 6

interface ChatInputProps {
  input: string
  setInput: (input: string) => void
  handleSubmit: (e: FormEvent) => void
  isLoading: boolean
  onStop?: () => void
  disabled?: boolean
  className?: string
  agents?: ChatAgent[]
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
  agents = [],
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
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionStart, setMentionStart] = useState<number | null>(null)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [handoffAnswers, setHandoffAnswers] = useState<Record<string, string>>({})
  const [activeHandoffIndex, setActiveHandoffIndex] = useState(0)

  const filteredAgents = useMemo(() => {
    if (mentionQuery === null) return []
    return agents.filter(agent =>
      agent.mention.toLowerCase().includes(`@${mentionQuery.toLowerCase()}`)
    )
  }, [agents, mentionQuery])

  // Auto-resize the textarea based on content
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = "0px"
      const scrollHeight = textarea.scrollHeight
      textarea.style.height = scrollHeight + "px"
    }
  }, [input])

  // Handle key presses for Ctrl+Enter to add new line and Enter to submit
  const updateMentionState = (value: string, cursor: number | null) => {
    if (cursor === null) {
      setMentionQuery(null)
      setMentionStart(null)
      return
    }
    const beforeCursor = value.slice(0, cursor)
    const match = beforeCursor.match(/(^|\s)@([a-zA-Z0-9_]*)$/)
    if (!match) {
      setMentionQuery(null)
      setMentionStart(null)
      return
    }
    setMentionQuery(match[2] ?? "")
    setMentionStart(cursor - (match[2]?.length ?? 0) - 1)
  }

  const insertAgentMention = (agent: ChatAgent) => {
    const textarea = textareaRef.current
    if (mentionStart === null || !textarea) return
    const cursor = textarea.selectionStart
    const before = input.slice(0, mentionStart)
    const after = input.slice(cursor)
    const nextInput = `${before}${agent.mention} ${after.replace(/^\s*/, "")}`
    const nextCursor = before.length + agent.mention.length + 1
    setInput(nextInput)
    setMentionQuery(null)
    setMentionStart(null)
    window.requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(nextCursor, nextCursor)
    })
  }

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
    if (mentionQuery !== null && filteredAgents.length > 0) {
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        insertAgentMention(filteredAgents[0])
        return
      }
      if (e.key === "Escape") {
        setMentionQuery(null)
        setMentionStart(null)
        return
      }
    }
    if (e.key === "Enter") {
      if (e.ctrlKey) {
        // Add a new line when Ctrl+Enter is pressed
        setInput(`${input}\n\n`)
        e.preventDefault()
      } else if (!e.shiftKey) {
        // Submit the form when Enter is pressed without Shift
        if (canSubmit) {
          e.preventDefault()
          handleSubmit(e as unknown as FormEvent)
          setMentionQuery(null)
          setMentionStart(null)
        }
      }
    }
  }

  return (
    <div className={`relative w-full bg-white p-4 ${className}`}>
      {mentionQuery !== null && filteredAgents.length > 0 && (
        <div className="absolute bottom-full left-3 z-50 mb-2 w-64 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
          {filteredAgents.map(agent => (
            <button
              key={agent.id}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
              onMouseDown={event => {
                event.preventDefault()
                insertAgentMention(agent)
              }}
            >
              <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold ${agent.className}`}>
                {agent.avatar}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="font-medium text-slate-950">{agent.name}</span>
                <span className="text-xs text-slate-500">{agent.mention}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <form
        onSubmit={handleSubmit}
        className="relative flex w-full flex-col gap-2 overflow-hidden rounded-lg border border-transparent bg-white p-3 shadow-sm"
      >
        <BorderBeam size={120} duration={8} borderWidth={1} colorFrom="#0f172a" colorTo="#38bdf8" />
        {handoffQuestions.length > 0 && activeHandoffQuestion && (
          <div className="relative z-10 rounded-md border border-sky-200 bg-sky-50 p-3">
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
                    className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  >
                    Back
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  disabled={(isLastHandoffQuestion ? !canSubmitHandoff : !canAdvanceHandoff) || isLoading || disabled}
                  onClick={isLastHandoffQuestion ? submitHandoffAnswers : advanceHandoffQuestion}
                  className="border border-slate-950 bg-slate-950 text-white hover:bg-slate-800"
                >
                  {isLastHandoffQuestion ? "Send answers" : "Next question"}
                </Button>
              </div>
            </div>
            <div className="rounded-md border border-sky-100 bg-white p-3">
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
                className="mt-2 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none placeholder:text-slate-400 focus:border-slate-400"
              />
            </div>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map(attachment => (
              <div
                key={attachment.id}
                className="flex max-w-[220px] items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700"
              >
                {attachment.type.startsWith("image/") ? (
                  <img
                    src={attachment.dataUrl}
                    alt=""
                    className="h-8 w-8 rounded-sm object-cover"
                  />
                ) : (
                  <FileText className="h-4 w-4 shrink-0" />
                )}
                <span className="min-w-0 truncate">{attachment.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${attachment.name}`}
                  className="rounded p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-950"
                  onClick={() => removeAttachment(attachment.id)}
                  disabled={isLoading || disabled}
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
            updateMentionState(e.target.value, e.target.selectionStart)
          }}
          onClick={e => updateMentionState(input, e.currentTarget.selectionStart)}
          onKeyUp={e => updateMentionState(e.currentTarget.value, e.currentTarget.selectionStart)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Type your message... (Ctrl+Enter for new line)"
          disabled={isLoading || disabled}
          className="min-h-[40px] max-h-[200px] flex-1 resize-none border-slate-200 bg-white py-2 text-slate-950 placeholder:text-slate-400 focus-visible:ring-slate-300"
          rows={1}
          autoFocus
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
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
              className="h-9 border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              disabled={isLoading || disabled || attachments.length >= MAX_ATTACHMENTS}
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
                className="h-9 max-w-[280px] min-w-[220px] border-slate-200 bg-white text-slate-700"
                size="sm"
              >
                <Github className="h-4 w-4" />
                <SelectValue
                  placeholder={isLoadingRepositories ? "Loading repositories..." : "Select repository"}
                />
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
            {repositoryLocked && (
              <span className="text-xs font-medium text-slate-500">Repository locked</span>
            )}
            <Select
              value={selectedStateBackendId || NO_STATE_BACKEND_VALUE}
              onValueChange={onStateBackendChange}
              disabled={isLoadingStateBackends || disabled}
            >
              <SelectTrigger
                aria-label="Terraform state backend"
                className="h-9 max-w-[280px] min-w-[220px] border-slate-200 bg-white text-slate-700"
                size="sm"
              >
                <Database className="h-4 w-4" />
                <SelectValue
                  placeholder={isLoadingStateBackends ? "Loading states..." : "Select state"}
                />
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
            disabled={isLoading ? disabled : !canSubmit || disabled}
            className={`h-10 border text-white ${
              isLoading
                ? "border-red-600 bg-red-600 hover:bg-red-700"
                : "border-slate-950 bg-slate-950 hover:bg-slate-800"
            }`}
            onClick={isLoading ? onStop : undefined}
          >
            {isLoading ? (
              <>
                <Square className="mr-2 h-4 w-4 fill-current" />
                Stop
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Send
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
