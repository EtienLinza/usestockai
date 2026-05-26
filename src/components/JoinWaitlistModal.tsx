import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tier, TIER_LABELS } from "@/lib/tier-features";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { Sparkles, Crown } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tier: Tier;
  billingCycle?: "monthly" | "annual";
}

export const JoinWaitlistModal = ({ open, onOpenChange, tier, billingCycle = "monthly" }: Props) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const Icon = tier === "elite" ? Crown : Sparkles;

  const handleJoin = async () => {
    if (!user) {
      onOpenChange(false);
      navigate("/auth?mode=signup");
      return;
    }
    setLoading(true);
    const { error } = await supabase.from("upgrade_waitlist").insert({
      user_id: user.id,
      requested_tier: tier,
      billing_cycle: billingCycle,
      notes: notes || null,
    });
    setLoading(false);
    if (error) {
      toast.error("Could not join waitlist. Please try again.");
      return;
    }
    toast.success("You're on the list — we'll email when payments launch.");
    onOpenChange(false);
    setNotes("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <Icon className="w-5 h-5 text-primary" />
            <span className="text-xs uppercase tracking-wide text-primary font-medium">
              {TIER_LABELS[tier]} waitlist
            </span>
          </div>
          <DialogTitle>Payments launching soon</DialogTitle>
          <DialogDescription>
            We're finalizing billing. Join the {TIER_LABELS[tier]} waitlist and we'll email you the moment it goes live — early members get priority pricing.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 my-2">
          <Textarea
            placeholder="Optional: tell us what you're hoping to use this for"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleJoin} disabled={loading}>
            {loading ? "Joining..." : "Join waitlist"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
