'use client'

import { Home, Package, User } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function CustomerBottomNav(props: any) {
  const { activeView, setActiveView } = props

  return (
    <>
      <aside className="hidden h-full w-60 shrink-0 flex-col border-r border-slate-200 bg-white p-3 md:flex">
        <div className="space-y-1.5">
          <Button variant="ghost" className={`w-full justify-start gap-2.5 h-10 rounded-lg transition-all ${activeView === 'home' ? 'bg-emerald-50 text-emerald-700' : 'text-slate-600 hover:bg-slate-100'}`} onClick={() => setActiveView('home')}>
            <Home className="h-4 w-4" />
            <span className="text-sm font-medium">Home</span>
          </Button>
          <Button variant="ghost" className={`w-full justify-start gap-2.5 h-10 rounded-lg transition-all ${activeView === 'orders' ? 'bg-emerald-50 text-emerald-700' : 'text-slate-600 hover:bg-slate-100'}`} onClick={() => setActiveView('orders')}>
            <Package className="h-4 w-4" />
            <span className="text-sm font-medium">Orders</span>
          </Button>
          <Button variant="ghost" className={`w-full justify-start gap-2.5 h-10 rounded-lg transition-all ${activeView === 'profile' ? 'bg-emerald-50 text-emerald-700' : 'text-slate-600 hover:bg-slate-100'}`} onClick={() => setActiveView('profile')}>
            <User className="h-4 w-4" />
            <span className="text-sm font-medium">Profile</span>
          </Button>
        </div>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-[#edf0f4]/95 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur md:hidden">
        <div className="grid grid-cols-3 gap-2">
          <Button
            variant="ghost"
            className={`h-14 flex-col gap-1 rounded-xl ${activeView === 'home' ? 'bg-emerald-50 text-emerald-700' : 'text-slate-700'}`}
            onClick={() => setActiveView('home')}
          >
            <Home className="h-4 w-4" />
            <span className="text-[11px] font-medium">Home</span>
          </Button>
          <Button
            variant="ghost"
            className={`h-14 flex-col gap-1 rounded-xl ${activeView === 'orders' ? 'bg-emerald-50 text-emerald-700' : 'text-slate-700'}`}
            onClick={() => setActiveView('orders')}
          >
            <Package className="h-4 w-4" />
            <span className="text-[11px] font-medium">Orders</span>
          </Button>
          <Button
            variant="ghost"
            className={`h-14 flex-col gap-1 rounded-xl ${activeView === 'profile' ? 'bg-emerald-50 text-emerald-700' : 'text-slate-700'}`}
            onClick={() => setActiveView('profile')}
          >
            <User className="h-4 w-4" />
            <span className="text-[11px] font-medium">Profile</span>
          </Button>
        </div>
      </nav>
    </>
  )
}
