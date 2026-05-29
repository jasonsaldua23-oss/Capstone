'use client'

import { ChevronDown, LogOut, MapPin, ShoppingCart, User } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { resolveClientImageUrl } from '@/lib/client-image'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function CustomerPortalHeader(props: any) {
  const {
    activeView,
    setActiveView,
    cartCount,
    avatarPreviewUrl,
    profileName,
    user,
    setIsAddressDialogOpen,
    handleLogout,
  } = props
  const resolvedAvatarPreviewUrl = resolveClientImageUrl(avatarPreviewUrl)

  return (
    <header className="shrink-0 border-b border-slate-200 bg-white text-slate-900">
      <div className="px-3 py-2.5 md:px-6 md:py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-8 w-8 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm md:h-10 md:w-10 md:rounded-xl">
              <img src="/aab-trading-shop.png" alt="AAB TRADING SHOP" className="h-full w-full object-contain p-1" />
            </div>
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
              className={`relative h-9 w-9 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 md:h-10 md:w-10 md:rounded-xl ${activeView === 'cart' ? 'bg-emerald-50 text-emerald-700' : ''}`}
              onClick={() => setActiveView('cart')}
              title="Open cart"
            >
              <ShoppingCart className="h-[18px] w-[18px]" />
              {cartCount > 0 && <span className="absolute -top-1 -right-1 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">{cartCount}</span>}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-slate-700 hover:bg-slate-50 md:h-10 md:rounded-xl md:px-2.5">
                  <Avatar className="mr-2 h-7 w-7 border border-white/25">
                    {resolvedAvatarPreviewUrl ? <AvatarImage src={resolvedAvatarPreviewUrl} alt={profileName || user?.name || 'Profile'} className="object-cover" /> : null}
                    <AvatarFallback className="bg-[#0e5aa8] text-white">
                      {(profileName || user?.name || 'C').charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden max-w-[120px] truncate text-sm font-semibold md:inline">{profileName || user?.name || 'Customer'}</span>
                  <ChevronDown className="ml-1.5 h-4 w-4 text-slate-500" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setActiveView('profile')}>
                  <User className="mr-2 h-4 w-4" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setActiveView('profile')
                    setIsAddressDialogOpen(true)
                  }}
                >
                  <MapPin className="mr-2 h-4 w-4" />
                  Shipping Address
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                  <LogOut className="mr-2 h-4 w-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  )
}
