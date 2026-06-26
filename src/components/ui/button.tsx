import * as React from "react"
import { cn } from "@/src/lib/utils"

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link"
  size?: "default" | "sm" | "lg" | "icon"
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-full text-sm font-medium transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-95",
          {
            "bg-primary text-white hover:bg-primary/90 editorial-shadow hover:scale-105": variant === "default",
            "bg-error text-white hover:bg-error/90 editorial-shadow hover:scale-105": variant === "destructive",
            "border border-primary text-primary hover:bg-primary/5": variant === "outline",
            "bg-secondary text-white hover:bg-secondary/90 editorial-shadow hover:scale-105": variant === "secondary",
            "text-primary hover:bg-primary/5": variant === "ghost",
            "text-primary underline-offset-4 hover:underline": variant === "link",
            "h-11 px-8 py-2": size === "default",
            "h-9 px-4": size === "sm",
            "h-12 px-10": size === "lg",
            "w-10 h-10 bg-primary/10 text-primary hover:bg-primary hover:text-white": size === "icon",
          },
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button }
