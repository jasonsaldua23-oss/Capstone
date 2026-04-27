'use client'

import { Home, Package, User } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function CustomerBottomNav(props: any) {
  const { activeView, setActiveView } = props

  return (
    <nav className="fixed bottom-2 left-2 right-2 overflow-hidden rounded-2xl border border-slate-200/90 bg-white/90 shadow-[0_12px_30px_rgba(15,23,42,0.12)] backdrop-blur-xl md:relative md:left-auto md:right-auto md:bottom-auto md:w-full md:rounded-none md:border md:border-t md:border-slate-200/70 md:shadow-[0_-2px_10px_rgba(15,23,42,0.07)]">
      {activeView === 'home' ? (
        <div className="h-1 w-full bg-[linear-gradient(90deg,#d94d4d_0%,#e2a43f_20%,#8bbd40_40%,#4ea5d9_64%,#63d1d8_84%,#6ca0d7_100%)]" />
      ) : null}
      <div className="grid grid-cols-3 py-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] md:pb-2">
        <Button variant="ghost" className={`flex-col gap-1 h-auto py-2 rounded-xl transition-all ${activeView === 'home' ? 'bg-[#1c56a8] text-white shadow-sm shadow-blue-900/30' : 'text-slate-600 hover:bg-transparent'}`} onClick={() => setActiveView('home')}>
          <Home className="h-4 w-4" />
          <span className="text-xs font-medium">Home</span>
        </Button>
        <Button variant="ghost" className={`flex-col gap-1 h-auto py-2 rounded-xl transition-all ${activeView === 'orders' ? 'bg-[#1c56a8] text-white shadow-sm shadow-blue-900/30' : 'text-slate-600 hover:bg-transparent'}`} onClick={() => setActiveView('orders')}>
          <Package className="h-4 w-4" />
          <span className="text-xs font-medium">Orders</span>
        </Button>
        <Button variant="ghost" className={`flex-col gap-1 h-auto py-2 rounded-xl transition-all ${activeView === 'profile' ? 'bg-[#1c56a8] text-white shadow-sm shadow-blue-900/30' : 'text-slate-600 hover:bg-transparent'}`} onClick={() => setActiveView('profile')}>
          <User className="h-4 w-4" />
          <span className="text-xs font-medium">Profile</span>
        </Button>
      </div>
    </nav>
  )
}
