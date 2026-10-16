import * as React from "react"
import { cn } from "@/src/lib/utils"

interface DialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-sm">
      <div 
        className="fixed inset-0" 
        onClick={() => onOpenChange?.(false)}
      />
      {children}
    </div>
  )
}

export function DialogContent({ children, className }: { children: React.ReactNode, className?: string }) {
  return (
    <div className={cn("relative z-50 grid w-full max-w-md gap-6 bg-surface p-8 md:p-10 shadow-tint editorial-shadow rounded-[2.5rem]", className)}>
      {children}
    </div>
  )
}

export function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col space-y-2 text-center sm:text-left",
        className
      )}
      {...props}
    />
  )
}

export function DialogTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn(
        "text-2xl font-headline font-semibold text-primary leading-tight tracking-tight",
        className
      )}
      {...props}
    />
  )
}

export function DialogDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("text-sm text-primary/70 font-body", className)}
      {...props}
    />
  )
}

export function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-4 pt-4",
        className
      )}
      {...props}
    />
  )
}
