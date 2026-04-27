'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function CustomerFeedbackView() {
  return (
    <Card>
      <CardHeader><CardTitle>Submit Feedback</CardTitle></CardHeader>
      <CardContent>
        <p className="text-sm text-gray-500">Use delivered orders to submit feedback.</p>
      </CardContent>
    </Card>
  )
}

