"use client";

import { type LucideIcon, XIcon } from "lucide-react";
import type { ComponentProps, HTMLAttributes } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type EditorShellProps = HTMLAttributes<HTMLDivElement>;

export const EditorShell = ({ className, ...props }: EditorShellProps) => (
  <div
    className={cn(
      "flex flex-col overflow-hidden rounded-lg border bg-background shadow-sm",
      className
    )}
    {...props}
  />
);

export type EditorShellHeaderProps = HTMLAttributes<HTMLDivElement>;

export const EditorShellHeader = ({
  className,
  ...props
}: EditorShellHeaderProps) => (
  <div
    className={cn(
      "flex items-center justify-between border-b bg-muted/50 px-4 py-3",
      className
    )}
    {...props}
  />
);

export type EditorShellCloseProps = ComponentProps<typeof Button>;

export const EditorShellClose = ({
  className,
  children,
  size = "sm",
  variant = "ghost",
  ...props
}: EditorShellCloseProps) => (
  <Button
    className={cn(
      "size-8 p-0 text-muted-foreground hover:text-foreground",
      className
    )}
    size={size}
    type="button"
    variant={variant}
    {...props}
  >
    {children ?? <XIcon className="size-4" />}
    <span className="sr-only">Close</span>
  </Button>
);

export type EditorShellTitleProps = HTMLAttributes<HTMLParagraphElement>;

export const EditorShellTitle = ({ className, ...props }: EditorShellTitleProps) => (
  <p
    className={cn("font-medium text-foreground text-sm", className)}
    {...props}
  />
);

export type EditorShellDescriptionProps = HTMLAttributes<HTMLParagraphElement>;

export const EditorShellDescription = ({
  className,
  ...props
}: EditorShellDescriptionProps) => (
  <p className={cn("text-muted-foreground text-sm", className)} {...props} />
);

export type EditorShellActionsProps = HTMLAttributes<HTMLDivElement>;

export const EditorShellActions = ({
  className,
  ...props
}: EditorShellActionsProps) => (
  <div className={cn("flex items-center gap-1", className)} {...props} />
);

export type EditorShellActionProps = ComponentProps<typeof Button> & {
  tooltip?: string;
  label?: string;
  icon?: LucideIcon;
};

export const EditorShellAction = ({
  tooltip,
  label,
  icon: Icon,
  children,
  className,
  size = "sm",
  variant = "ghost",
  ...props
}: EditorShellActionProps) => {
  const button = (
    <Button
      className={cn(
        "size-8 p-0 text-muted-foreground hover:text-foreground",
        className
      )}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      {Icon ? <Icon className="size-4" /> : children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  );

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return button;
};

export type EditorShellContentProps = HTMLAttributes<HTMLDivElement>;

export const EditorShellContent = ({
  className,
  ...props
}: EditorShellContentProps) => (
  <div className={cn("flex-1 overflow-auto p-4", className)} {...props} />
);
