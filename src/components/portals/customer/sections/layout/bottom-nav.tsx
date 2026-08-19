'use client'

import { ClipboardList, Home, Package, User } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function CustomerBottomNav(props: any) {
  const { activeView, setActiveView, setSelectedOrder } = props

  const handleNav = (view: string) => {
    setSelectedOrder?.(null)
    setActiveView(view)
  }

  return (
    <>
      {/* ── Desktop sidebar ── */}
      <aside className="hidden h-full w-60 shrink-0 flex-col border-r border-slate-200 bg-white p-3 md:flex">
        <div className="space-y-1.5">
          <Button
            variant="ghost"
            className={`w-full justify-start gap-2.5 h-10 rounded-lg transition-all ${activeView === 'home' ? 'bg-emerald-50 text-emerald-700' : 'text-slate-600 hover:bg-slate-100'}`}
            onClick={() => handleNav('home')}
          >
            <Home className="h-4 w-4" />
            <span className="text-sm font-medium">Home</span>
          </Button>

          <Button
            variant="ghost"
            className={`w-full justify-start gap-2.5 h-10 rounded-lg transition-all ${activeView === 'purchase-requests' ? 'bg-emerald-50 text-emerald-700' : 'text-slate-600 hover:bg-slate-100'}`}
            onClick={() => handleNav('purchase-requests')}
          >
            <ClipboardList className="h-4 w-4" />
            <span className="text-sm font-medium">Purchase Request</span>
          </Button>

          <Button
            variant="ghost"
            className={`w-full justify-start gap-2.5 h-10 rounded-lg transition-all ${activeView === 'orders' ? 'bg-emerald-50 text-emerald-700' : 'text-slate-600 hover:bg-slate-100'}`}
            onClick={() => handleNav('orders')}
          >
            <Package className="h-4 w-4" />
            <span className="text-sm font-medium">Purchase Order</span>
          </Button>

          <Button
            variant="ghost"
            className={`w-full justify-start gap-2.5 h-10 rounded-lg transition-all ${activeView === 'profile' ? 'bg-emerald-50 text-emerald-700' : 'text-slate-600 hover:bg-slate-100'}`}
            onClick={() => handleNav('profile')}
          >
            <User className="h-4 w-4" />
            <span className="text-sm font-medium">Profile</span>
          </Button>
        </div>
      </aside>

      {/* ── Mobile bottom nav ── */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-[#edf0f4]/95 px-2 pb-[max(0.375rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur md:hidden">
        <div className="grid grid-cols-4 gap-1">
          <Button
            variant="ghost"
            className={`h-12 flex-col gap-0.5 rounded-xl ${activeView === 'home' ? 'bg-emerald-50 text-emerald-700' : 'text-slate-700'}`}
            onClick={() => handleNav('home')}
          >
            <Home className="h-4 w-4" />
            <span className="text-[10px] font-medium">Home</span>
          </Button>

          <Button
            variant="ghost"
            className={`h-12 flex-col gap-0.5 rounded-xl ${activeView === 'purchase-requests' ? 'bg-emerald-50 text-emerald-700' : 'text-slate-700'}`}
            onClick={() => handleNav('purchase-requests')}
          >
            <ClipboardList className="h-4 w-4" />
            <span className="text-[10px] font-medium leading-tight">Purchase Req.</span>
          </Button>

          <Button
            variant="ghost"
            className={`h-12 flex-col gap-0.5 rounded-xl ${activeView === 'orders' ? 'bg-emerald-50 text-emerald-700' : 'text-slate-700'}`}
            onClick={() => handleNav('orders')}
          >
            <Package className="h-4 w-4" />
            <span className="text-[10px] font-medium leading-tight">Purchase Order</span>
          </Button>

          <Button
            variant="ghost"
            className={`h-12 flex-col gap-0.5 rounded-xl ${activeView === 'profile' ? 'bg-emerald-50 text-emerald-700' : 'text-slate-700'}`}
            onClick={() => handleNav('profile')}
          >
            <User className="h-4 w-4" />
            <span className="text-[10px] font-medium">Profile</span>
          </Button>
        </div>
      </nav>
    </>
  )
}
