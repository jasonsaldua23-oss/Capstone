/**
 * The two-tone siren of the warehouse emergency alarm (see incident-alarm.ts).
 *
 * Made in the browser, with no sound file. The rhythm runs on the audio clock - a slow
 * square wave swings the tone between its two pitches - so a portal hidden behind
 * other windows keeps ringing evenly even when the browser slows its timers down.
 *
 * Browsers only let a page make sound once someone has clicked or typed in it, so
 * `unlock` is called on every gesture in the portal; until then `isBlocked` is true
 * while the siren should be sounding, and the alarm asks for a click.
 */

const LOW_HZ = 650
const HIGH_HZ = 960
const SECONDS_PER_TONE = 0.45
// Square waves are loud for their level; how loud it really is depends on the laptop.
const VOLUME = 0.7

export type IncidentSiren = {
  start(): void
  stop(): void
  unlock(): void
  isBlocked(): boolean
  subscribe(listener: () => void): () => void
}

type AudioContextClass = typeof AudioContext

function createSiren(AudioContextImpl: AudioContextClass): IncidentSiren {
  let audio: AudioContext | null = null
  let sounding: { oscillators: OscillatorNode[]; nodes: AudioNode[] } | null = null
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((listener) => listener())

  const context = () => {
    if (!audio) {
      audio = new AudioContextImpl()
      audio.onstatechange = notify
    }
    return audio
  }
  const resume = (target: AudioContext) => {
    if (target.state !== 'running') void target.resume().catch(() => undefined)
  }

  return {
    unlock() {
      // Created or resumed inside a click, the context may play from then on.
      resume(context())
    },
    start() {
      if (sounding) return
      const target = context()
      const tone = target.createOscillator()
      tone.type = 'square'
      tone.frequency.value = (LOW_HZ + HIGH_HZ) / 2
      const sweep = target.createOscillator()
      sweep.type = 'square'
      sweep.frequency.value = 1 / (2 * SECONDS_PER_TONE)
      const depth = target.createGain()
      depth.gain.value = (HIGH_HZ - LOW_HZ) / 2
      const volume = target.createGain()
      volume.gain.value = VOLUME
      sweep.connect(depth).connect(tone.frequency)
      tone.connect(volume).connect(target.destination)
      tone.start()
      sweep.start()
      sounding = { oscillators: [tone, sweep], nodes: [depth, volume] }
      resume(target)
      notify()
    },
    stop() {
      if (!sounding) return
      for (const oscillator of sounding.oscillators) {
        try {
          oscillator.stop()
        } catch {
          // Already stopped.
        }
        oscillator.disconnect()
      }
      sounding.nodes.forEach((node) => node.disconnect())
      sounding = null
      notify()
    },
    isBlocked() {
      return sounding !== null && audio?.state !== 'running'
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

let shared: IncidentSiren | null | undefined

/** One siren per tab, or null where the browser has no Web Audio (or on the server). */
export function getIncidentSiren(): IncidentSiren | null {
  if (shared !== undefined) return shared
  if (typeof window === 'undefined') return null
  const AudioContextImpl =
    window.AudioContext || (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext
  shared = AudioContextImpl ? createSiren(AudioContextImpl) : null
  return shared
}
