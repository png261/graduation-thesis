"use client";

import { isToday, isYesterday, subMonths, subWeeks } from "date-fns";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { toast } from "sonner";
import useSWRInfinite from "swr/infinite";
import type { Chat } from "@/lib/db/schema";
import { fetcher } from "@/lib/utils";
import { useWorkspace } from "@/hooks/use-workspace";
import { TrashIcon, MoreHorizontalIcon, ClockIcon, SearchIcon } from "lucide-react";
import { LoaderIcon } from "./icons";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "./ui/dialog";
import { Button } from "./ui/button";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "./ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface GroupedChats {
    today: Chat[];
    yesterday: Chat[];
    lastWeek: Chat[];
    lastMonth: Chat[];
    older: Chat[];
}

interface ChatHistory {
    chats: Chat[];
    hasMore: boolean;
}

const PAGE_SIZE = 20;

function groupChatsByDate(chats: Chat[]): GroupedChats {
    const now = new Date();
    const oneWeekAgo = subWeeks(now, 1);
    const oneMonthAgo = subMonths(now, 1);

    return chats.reduce(
        (groups, chat) => {
            const chatDate = new Date(chat.createdAt);

            if (isToday(chatDate)) {
                groups.today.push(chat);
            } else if (isYesterday(chatDate)) {
                groups.yesterday.push(chat);
            } else if (chatDate > oneWeekAgo) {
                groups.lastWeek.push(chat);
            } else if (chatDate > oneMonthAgo) {
                groups.lastMonth.push(chat);
            } else {
                groups.older.push(chat);
            }

            return groups;
        },
        {
            today: [],
            yesterday: [],
            lastWeek: [],
            lastMonth: [],
            older: [],
        } as GroupedChats
    );
}

function getChatHistoryPaginationKey(
    pageIndex: number,
    previousPageData: ChatHistory,
    workspaceId?: string
) {
    if (previousPageData && !previousPageData.hasMore) {
        return null;
    }

    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    params.set("page", String(pageIndex));
    if (workspaceId) {
        params.set("workspaceId", workspaceId);
    }

    return `/api/history?${params.toString()}`;
}

function ChatGroup({
    label,
    chats,
    activeChatId,
    onDelete,
    onClose,
}: {
    label: string;
    chats: Chat[];
    activeChatId: string | null;
    onDelete: (chatId: string) => void;
    onClose: () => void;
}) {
    if (chats.length === 0) return null;

    return (
        <div>
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {label}
            </div>
            {chats.map((chat) => (
                <Link
                    key={chat.id}
                    href={`/chat/${chat.id}`}
                    onClick={onClose}
                    className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition-colors group ${chat.id === activeChatId
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-muted/50"
                        }`}
                >
                    <span className="truncate flex-1">{chat.title}</span>
                    <button
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onDelete(chat.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity shrink-0"
                    >
                        <TrashIcon size={14} />
                    </button>
                </Link>
            ))}
        </div>
    );
}

export function HistoryModal() {
    const pathname = usePathname();
    const router = useRouter();
    const activeChatId = pathname?.startsWith("/chat/")
        ? pathname.split("/")[2]
        : null;

    const { data: session } = useSession();
    const { currentWorkspaceId } = useWorkspace();
    const [open, setOpen] = useState(false);
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");

    const {
        data: paginatedChatHistories,
        setSize,
        isValidating,
        isLoading,
        mutate,
    } = useSWRInfinite<ChatHistory>(
        (pageIndex, previousPageData) =>
            open
                ? getChatHistoryPaginationKey(
                    pageIndex,
                    previousPageData,
                    currentWorkspaceId
                )
                : null,
        fetcher,
        {
            fallbackData: [],
        }
    );

    const hasReachedEnd = paginatedChatHistories
        ? paginatedChatHistories.some((page) => page.hasMore === false)
        : false;

    const allChats = paginatedChatHistories
        ? paginatedChatHistories.flatMap((page) => page.chats)
        : [];

    const filteredChats = searchQuery
        ? allChats.filter((chat) =>
            chat.title.toLowerCase().includes(searchQuery.toLowerCase())
        )
        : allChats;

    const groupedChats = groupChatsByDate(filteredChats);

    const handleDelete = () => {
        const chatToDelete = deleteId;
        const isCurrentChat = pathname === `/chat/${chatToDelete}`;

        setShowDeleteDialog(false);

        const deletePromise = fetch(`/api/chat?id=${chatToDelete}`, {
            method: "DELETE",
        });

        toast.promise(deletePromise, {
            loading: "Deleting chat...",
            success: () => {
                mutate((chatHistories) => {
                    if (chatHistories) {
                        return chatHistories.map((chatHistory) => ({
                            ...chatHistory,
                            chats: chatHistory.chats.filter(
                                (chat) => chat.id !== chatToDelete
                            ),
                        }));
                    }
                });

                if (isCurrentChat) {
                    router.replace("/");
                    router.refresh();
                }

                return "Chat deleted successfully";
            },
            error: "Failed to delete chat",
        });
    };

    const handleClose = () => setOpen(false);

    return (
        <>
            <Dialog open={open} onOpenChange={setOpen}>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <DialogTrigger asChild>
                            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                                <ClockIcon size={14} />
                                History
                            </Button>
                        </DialogTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Chat History</TooltipContent>
                </Tooltip>

                <DialogContent className="max-w-lg max-h-[70vh] flex flex-col p-0">
                    <DialogHeader className="p-4 pb-0">
                        <DialogTitle>Chat History</DialogTitle>
                    </DialogHeader>

                    {/* Search */}
                    <div className="px-4 py-2">
                        <div className="relative">
                            <SearchIcon
                                size={14}
                                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                            />
                            <input
                                type="text"
                                placeholder="Search conversations..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border bg-muted/30 focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                        </div>
                    </div>

                    {/* Chat list */}
                    <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-3">
                        {!session?.user && (
                            <div className="text-center text-sm text-muted-foreground py-8">
                                Login to save and revisit previous chats!
                            </div>
                        )}

                        {session?.user && isLoading && (
                            <div className="flex items-center gap-2 justify-center py-8 text-muted-foreground">
                                <div className="animate-spin">
                                    <LoaderIcon />
                                </div>
                                <span className="text-sm">Loading chats...</span>
                            </div>
                        )}

                        {session?.user && !isLoading && allChats.length === 0 && (
                            <div className="text-center text-sm text-muted-foreground py-8">
                                Your conversations will appear here once you start chatting!
                            </div>
                        )}

                        {session?.user && !isLoading && allChats.length > 0 && (
                            <>
                                <ChatGroup
                                    label="Today"
                                    chats={groupedChats.today}
                                    activeChatId={activeChatId}
                                    onDelete={(id) => {
                                        setDeleteId(id);
                                        setShowDeleteDialog(true);
                                    }}
                                    onClose={handleClose}
                                />
                                <ChatGroup
                                    label="Yesterday"
                                    chats={groupedChats.yesterday}
                                    activeChatId={activeChatId}
                                    onDelete={(id) => {
                                        setDeleteId(id);
                                        setShowDeleteDialog(true);
                                    }}
                                    onClose={handleClose}
                                />
                                <ChatGroup
                                    label="Last 7 days"
                                    chats={groupedChats.lastWeek}
                                    activeChatId={activeChatId}
                                    onDelete={(id) => {
                                        setDeleteId(id);
                                        setShowDeleteDialog(true);
                                    }}
                                    onClose={handleClose}
                                />
                                <ChatGroup
                                    label="Last 30 days"
                                    chats={groupedChats.lastMonth}
                                    activeChatId={activeChatId}
                                    onDelete={(id) => {
                                        setDeleteId(id);
                                        setShowDeleteDialog(true);
                                    }}
                                    onClose={handleClose}
                                />
                                <ChatGroup
                                    label="Older"
                                    chats={groupedChats.older}
                                    activeChatId={activeChatId}
                                    onDelete={(id) => {
                                        setDeleteId(id);
                                        setShowDeleteDialog(true);
                                    }}
                                    onClose={handleClose}
                                />

                                {!hasReachedEnd && (
                                    <button
                                        onClick={() => setSize((s) => s + 1)}
                                        disabled={isValidating}
                                        className="w-full text-center text-xs text-muted-foreground py-2 hover:text-foreground transition-colors"
                                    >
                                        {isValidating ? "Loading..." : "Load more"}
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            <AlertDialog onOpenChange={setShowDeleteDialog} open={showDeleteDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete your
                            chat and remove it from our servers.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete}>
                            Continue
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
