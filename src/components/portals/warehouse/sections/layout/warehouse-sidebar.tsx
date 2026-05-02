'use client'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { LogOut } from 'lucide-react'

type SidebarNavItem = {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

type WarehouseSidebarProps = {
  navItems: SidebarNavItem[]
  activeView: string
  onSelectView: (viewId: string) => void
  onLogout: () => void
}

export function WarehouseSidebar({ navItems, activeView, onSelectView, onLogout }: WarehouseSidebarProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-white/20 bg-white/10 p-4 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <img
            src="/ann-anns-logo.png"
            alt="Ann Ann's Beverages Trading logo"
            className="h-11 w-11 rounded-xl border border-white/40 object-cover shadow-[0_10px_24px_rgba(15,23,42,0.14)]"
          />
          <div>
            <h2 className="font-bold text-slate-950">Ann Ann's Beverages Trading</h2>
            <p className="text-xs text-slate-600">Warehouse Portal</p>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1 p-2">
        <nav className="space-y-1">
          {navItems.map((navItem) => (
            <Button
              key={navItem.id}
              variant={activeView === navItem.id ? 'secondary' : 'ghost'}
              className={`w-full justify-start gap-3 ${
                activeView === navItem.id
                  ? 'border border-white/50 bg-linear-to-r from-cyan-600/95 via-sky-600/95 to-emerald-500/90 text-white shadow-[0_14px_30px_rgba(8,145,178,0.26)]'
                  : 'text-slate-700 hover:bg-white/45 hover:text-slate-950'
              }`}
              onClick={() => onSelectView(navItem.id)}
            >
              <navItem.icon className="h-4 w-4" />
              {navItem.label}
            </Button>
          ))}
        </nav>
      </ScrollArea>

      <div className="border-t border-white/25 p-3">
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-slate-700 hover:bg-white/45 hover:text-red-600"
          onClick={onLogout}
        >
          <LogOut className="h-4 w-4" />
          Logout
        </Button>
      </div>
    </div>
  )
}
