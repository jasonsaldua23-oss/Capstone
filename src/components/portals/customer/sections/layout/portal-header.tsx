'use client'

import { LogOut, MapPin, ShoppingCart, User } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
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

  return (
    <header className="sticky top-0 z-20 shrink-0 border-b border-sky-200/70 bg-[#edf5fb]/95 text-[#0f3d72] shadow-[0_10px_24px_rgba(15,23,42,0.12)] backdrop-blur-md">
      <div className="px-4 pb-3 pt-[max(env(safe-area-inset-top),0.65rem)] md:py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center overflow-hidden rounded-2xl border border-white/90 bg-white shadow-[0_6px_14px_rgba(15,23,42,0.14)]">
              <img src="/annshop.png" alt="AnnShop" className="h-full w-full object-cover" />
            </div>
            <div className="leading-tight">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-700">Ann Ann's Beverages Trading</p>
              <h1 className="text-[18px] font-black tracking-[-0.01em] text-[#0f3d72]">Ann<span className="text-[#2f9a34]">Shop</span></h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className={`relative h-10 w-10 rounded-xl border border-blue-200/70 bg-white text-[#0f3d72] shadow-sm shadow-blue-900/15 hover:bg-sky-50 ${activeView === 'cart' ? 'bg-sky-100' : ''}`}
              onClick={() => setActiveView('cart')}
              title="Open cart"
            >
              <ShoppingCart className="h-4.5 w-4.5" />
              {cartCount > 0 && <span className="absolute -top-1 -right-1 rounded-full bg-lime-300/95 px-1.5 py-0.5 text-[10px] font-semibold text-lime-950 shadow-sm shadow-lime-900/30">{cartCount}</span>}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full border border-blue-200/70 bg-[#0e5aa8] text-white shadow-sm shadow-blue-900/30 hover:bg-[#0d4f92]">
                  <Avatar className="h-8 w-8 border border-white/20">
                    {avatarPreviewUrl ? <AvatarImage src={avatarPreviewUrl} alt={profileName || user?.name || 'Profile'} /> : null}
                    <AvatarFallback className="bg-[#0e5aa8] text-white">
                      {(profileName || user?.name || 'C').charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
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
        <div className="mt-2 flex items-center justify-between">
          <p className="text-[1.1rem] font-semibold tracking-tight text-[#0a1b36]">SHOPP APP</p>
        </div>
      </div>
    </header>
  )
}
