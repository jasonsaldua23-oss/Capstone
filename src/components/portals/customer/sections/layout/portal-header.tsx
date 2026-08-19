'use client'

import { Bell, ShoppingCart } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function CustomerPortalHeader(props: any) {
  const {
    activeView,
    setActiveView,
    cartCount,
    onOpenNotifications,
    unreadCount = 0,
  } = props

  return (
    <header className="shrink-0 border-b border-slate-200 bg-white text-slate-900">
      <div className="px-3 py-2.5 md:px-6 md:py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="leading-tight">
              <p className="text-[8px] uppercase tracking-[0.14em] text-slate-500 md:text-[9px] md:tracking-[0.16em]">ANN ANN'S BEVERAGES TRADING</p>
              <h1 className="text-[20px] font-extrabold tracking-[-0.02em] text-[#123e73] md:text-[26px]">
                AAB TRADING<span className="text-[#2f9a34]"> SHOP</span>
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-1.5 md:gap-2.5">
            <Button
              variant="ghost"
              size="icon"
              className={`relative h-10 w-10 rounded-lg text-slate-700 hover:bg-slate-50 md:h-11 md:w-11 md:rounded-xl ${activeView === 'cart' ? 'bg-emerald-50 text-emerald-700' : ''}`}
              onClick={() => setActiveView('cart')}
              title="Open cart"
            >
              <ShoppingCart className="h-5 w-5" />
              {cartCount > 0 && (
                <span className="absolute -top-1 -right-1 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {cartCount}
                </span>
              )}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="relative h-10 w-10 rounded-lg text-slate-700 hover:bg-slate-50 md:h-11 md:w-11 md:rounded-xl"
              onClick={onOpenNotifications}
              title="Notifications"
            >
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white ring-2 ring-white animate-pulse">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
