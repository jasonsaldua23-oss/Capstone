'use client'

import { AlertTriangle } from 'lucide-react'
import { vehicleConditionLabel, type IncidentMarkerInfo } from '@/lib/vehicle-incidents'
import { INCIDENT_TONE_COLORS } from './icons'

const DESCRIPTION_PREVIEW_LENGTH = 180

/**
 * What a map popup says about an open incident, above the vehicle's usual details.
 * Margins are inline because Leaflet's own popup stylesheet spaces paragraphs out.
 */
export function IncidentPopupDetails({ incident }: { incident: IncidentMarkerInfo }) {
  const color = INCIDENT_TONE_COLORS[incident.tone]
  const reportedAt = new Date(incident.reportedAt)
  const reported = Number.isNaN(reportedAt.getTime())
    ? ''
    : reportedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const description =
    incident.description.length > DESCRIPTION_PREVIEW_LENGTH
      ? `${incident.description.slice(0, DESCRIPTION_PREVIEW_LENGTH).trimEnd()}…`
      : incident.description
  return (
    <div style={{ borderLeft: `3px solid ${color}`, paddingLeft: 8, marginBottom: 8 }}>
      <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 4, color, fontWeight: 700 }}>
        <AlertTriangle size={14} aria-hidden="true" />
        {incident.typeLabel} reported{reported ? ` · ${reported}` : ''}
      </p>
      <p style={{ margin: '2px 0 0', color: '#374151' }}>
        {incident.incidentNumber} · {incident.progressLabel}
      </p>
      <p style={{ margin: '2px 0 0', color: incident.vehicleCanContinue ? '#4b5563' : '#b91c1c', fontWeight: incident.vehicleCanContinue ? 400 : 600 }}>
        {vehicleConditionLabel(incident.vehicleCanContinue)}
      </p>
      {description ? (
        <p style={{ margin: '4px 0 0', color: '#4b5563', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{description}</p>
      ) : null}
    </div>
  )
}
