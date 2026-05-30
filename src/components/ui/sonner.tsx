"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast border border-slate-200 bg-white text-slate-900 shadow-lg",
          success:
            "border-blue-200 bg-blue-50 text-blue-900 [&_[data-icon]]:text-blue-700",
          error:
            "border-red-200 bg-red-50 text-red-900 [&_[data-icon]]:text-red-700",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
