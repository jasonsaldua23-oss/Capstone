"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import SignaturePad from "@/components/shared/SignaturePad";
import { CheckCircle } from "lucide-react";

interface ProofOfDeliveryFormProps {
  tripId: string;
  stopId: string;
  onSuccess?: () => void;
}

export default function ProofOfDeliveryForm({ tripId, stopId, onSuccess }: ProofOfDeliveryFormProps) {
  const [loading, setLoading] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    const formData = new FormData(e.currentTarget);
    const recipientName = formData.get("recipientName") as string;
    
    if (!recipientName || !signature) {
      toast.error("Both recipient name and signature are required.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`/api/trips/${tripId}/stops/${stopId}/deliver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientName,
          recipientSignature: signature, // Sending base64 signature
          notes: formData.get("notes"),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to submit proof of delivery.");
      }

      toast.success("Delivery marked as completed!");
      if (onSuccess) onSuccess();

    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-md mx-auto bg-slate-50 p-4 rounded-xl border">
      <div className="space-y-2">
        <h3 className="text-lg font-bold text-slate-800">Proof of Delivery</h3>
        <p className="text-sm text-slate-500">Please have the customer sign to confirm receipt.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="recipientName">Recipient Name</Label>
        <Input id="recipientName" name="recipientName" placeholder="e.g. Jane Doe" required />
      </div>

      <div className="space-y-2">
        <Label>Customer Signature</Label>
        {/* Reusable SignaturePad component we just built */}
        <SignaturePad onChange={setSignature} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Delivery Notes (Optional)</Label>
        <Textarea id="notes" name="notes" placeholder="e.g. Left at front door with receptionist" />
      </div>

      <Button type="submit" className="w-full" size="lg" disabled={loading || !signature}>
        {loading ? (
          "Submitting..."
        ) : (
          <><CheckCircle className="w-5 h-5 mr-2" /> Complete Delivery</>
        )}
      </Button>
    </form>
  );
}