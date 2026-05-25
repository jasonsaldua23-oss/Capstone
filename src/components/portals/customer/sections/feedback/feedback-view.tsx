'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useEffect, useState } from 'react'
import { PortalCardsSkeleton } from '@/components/portals/shared/loading-skeletons'
import { fetchFeedbackMeta } from './feedback-api'

interface FeedbackItem {
  id: string
  subject: string
  message: string
  rating: number
  type: 'COMPLAINT' | 'SUGGESTION' | 'COMPLIMENT'
  createdAt: string
}

export function CustomerFeedbackView() {
  const [feedbackItems, setFeedbackItems] = useState<FeedbackItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const loadFeedback = async () => {
      try {
        const data = await fetchFeedbackMeta()
        if (data?.results) {
          setFeedbackItems(data.results)
        }
      } catch (error) {
        console.error('Failed to load feedback:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadFeedback()
  }, [])

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Your Feedback</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500">Use delivered orders to submit feedback.</p>
        </CardContent>
      </Card>

      {isLoading ? (
        <PortalCardsSkeleton cards={3} />
      ) : feedbackItems.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <p className="text-center text-sm text-gray-500">No feedback submitted yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {feedbackItems.map((feedback) => (
            <Card key={feedback.id} className="overflow-hidden">
              <CardContent className="pt-6">
                <div className="flex gap-4">
                  {/* Quotation Mark Icon */}
                  <div className="flex-shrink-0">
                    <svg
                      className="h-8 w-8 text-blue-500"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M3 21c3 -1 7 -1 11 0 7 0 12.4 -1 13 -2 1 -1 0 -2 -2 -2 -3 0 -11 1 -13 0 -2 -2 -1 -6 -1 -6 0 -4 2 -5 5 -5 2 0 4 1 4 3 0 1 -1 3 -3 4 -1 1 1 4 4 4 -0 2 -1 3 -2 3 -1 0 -1 1 -3 1 -3 0 -7 -1 -10 -3 -2 -2 -1 -6 -1 -6 s 0 -2 1 -2 1 0 3 2 3 2 0 2 -3 3 -4 3z" />
                    </svg>
                  </div>

                  {/* Feedback Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="font-semibold text-slate-900">{feedback.subject}</h3>
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
                        feedback.type === 'COMPLAINT'
                          ? 'bg-red-100 text-red-700'
                          : feedback.type === 'SUGGESTION'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-green-100 text-green-700'
                      }`}>
                        {feedback.type}
                      </span>
                    </div>
                    <p className="text-slate-700 text-sm mb-3 whitespace-pre-wrap">{feedback.message}</p>
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>{'★'.repeat(feedback.rating)}{'☆'.repeat(5 - feedback.rating)} {feedback.rating}/5</span>
                      <span>{new Date(feedback.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
