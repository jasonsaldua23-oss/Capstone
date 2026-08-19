'use client'

import { useEffect, useState } from 'react'
import { Loader2, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

export type PackagingProfileRow = {
  id: string
  code: string
  name: string
  containerType: string
  containerSize: string
  standardUnitsPerCase: number
  allowedMixedCaseCapacities: number[]
  compatibilityKey: string
  baseUnitLabel: string
  isActive: boolean
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  profiles: PackagingProfileRow[]
  onSaved: () => Promise<void> | void
}

const emptyForm = {
  id: '', code: '', name: '', containerType: 'bottle', containerSize: '',
  standardUnitsPerCase: '24', allowedMixedCaseCapacities: '24', compatibilityKey: '',
  baseUnitLabel: 'bottle', isActive: true,
}

export function PackagingProfileDialog({ open, onOpenChange, profiles, onSaved }: Props) {
  const [form, setForm] = useState(emptyForm)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!open) setForm(emptyForm)
  }, [open])

  const edit = (profile: PackagingProfileRow) => setForm({
    id: profile.id,
    code: profile.code,
    name: profile.name,
    containerType: profile.containerType,
    containerSize: profile.containerSize,
    standardUnitsPerCase: String(profile.standardUnitsPerCase),
    allowedMixedCaseCapacities: profile.allowedMixedCaseCapacities.join(', '),
    compatibilityKey: profile.compatibilityKey,
    baseUnitLabel: profile.baseUnitLabel,
    isActive: profile.isActive,
  })

  const save = async () => {
    const standardUnitsPerCase = Math.floor(Number(form.standardUnitsPerCase))
    const allowedMixedCaseCapacities = Array.from(new Set(
      form.allowedMixedCaseCapacities.split(',')
        .map((value) => Math.floor(Number(value.trim())))
        .filter((value) => Number.isFinite(value) && value > 0)
    )).sort((a, b) => a - b)
    if (!form.code.trim() || !form.name.trim() || !form.containerType.trim() || !form.containerSize.trim()) {
      return toast.error('Code, name, container type, and container size are required')
    }
    if (!Number.isFinite(standardUnitsPerCase) || standardUnitsPerCase <= 0) {
      return toast.error('Standard units per case must be positive')
    }
    setIsSaving(true)
    try {
      const response = await fetch(form.id ? `/api/packaging-profiles/${form.id}` : '/api/packaging-profiles', {
        method: form.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: form.code.trim(),
          name: form.name.trim(),
          containerType: form.containerType.trim(),
          containerSize: form.containerSize.trim(),
          standardUnitsPerCase,
          allowedMixedCaseCapacities,
          compatibilityKey: form.compatibilityKey.trim() || undefined,
          baseUnitLabel: form.baseUnitLabel.trim() || 'unit',
          isActive: form.isActive,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.success === false) throw new Error(data?.error || 'Unable to save packaging profile')
      toast.success(form.id ? 'Packaging profile updated' : 'Packaging profile created')
      await onSaved()
      setForm(emptyForm)
    } catch (error: any) {
      toast.error(error?.message || 'Unable to save packaging profile')
    } finally {
      setIsSaving(false)
    }
  }

  const field = (key: keyof typeof emptyForm, label: string, props: Record<string, any> = {}) => (
    <label className="space-y-1 text-sm">
      <span>{label}</span>
      <Input {...props} value={String(form[key])} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} />
    </label>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Packaging Profiles</DialogTitle>
          <DialogDescription>Define compatible base units and the capacities customers may use for Mixed Cases.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-800">Existing profiles</p>
              <Button size="sm" variant="outline" onClick={() => setForm(emptyForm)}><Plus className="mr-1 h-4 w-4" /> New</Button>
            </div>
            {profiles.map((profile) => (
              <button key={profile.id} type="button" onClick={() => edit(profile)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50">
                <span>
                  <span className="block text-sm font-medium text-slate-900">{profile.name}</span>
                  <span className="block text-xs text-slate-500">{profile.containerSize} · {profile.standardUnitsPerCase}/case · capacities {profile.allowedMixedCaseCapacities.join(', ')}</span>
                </span>
                <Pencil className="h-4 w-4 text-slate-500" />
              </button>
            ))}
            {profiles.length === 0 ? <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">No packaging profiles yet.</p> : null}
          </div>
          <div className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-2">
            {field('code', 'Code')}
            {field('name', 'Name')}
            {field('containerType', 'Container type')}
            {field('containerSize', 'Container size')}
            {field('standardUnitsPerCase', 'Standard units/case', { type: 'number', min: 1 })}
            {field('allowedMixedCaseCapacities', 'Allowed capacities', { placeholder: '12, 24' })}
            {field('compatibilityKey', 'Compatibility key', { placeholder: 'Auto-generated if blank' })}
            {field('baseUnitLabel', 'Base-unit label')}
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} /> Active for ordering
            </label>
            <Button className="sm:col-span-2" onClick={save} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {form.id ? 'Save profile' : 'Create profile'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
