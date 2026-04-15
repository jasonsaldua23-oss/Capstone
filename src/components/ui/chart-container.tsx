"use client"

import * as React from "react"
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  BarElement,
  ArcElement,
} from "chart.js"
import { cn } from "@/lib/utils"

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  BarElement,
  ArcElement
)

const ChartContainer = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    config?: any
    chartType?: "line" | "bar" | "pie" | "doughnut" | "polarArea" | "radar"
  }
>(({ id, className, children, ...props }, ref) => {
  return (
    <div
      ref={ref}
      id={id}
      className={cn("w-full h-full", className)}
      {...props}
    >
      {children}
    </div>
  )
})

ChartContainer.displayName = "ChartContainer"

export default ChartContainer
