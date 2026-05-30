import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, Mail, LogOut, Trash2, User as UserIcon, Bell, KeyRound } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

interface ProfileFields {
  full_name: string;
  avatar_url: string;
  weekly_digest_enabled: boolean;
  alert_email_enabled: boolean;
}

const DEFAULTS: ProfileFields = {
  full_name: "",
  avatar_url: "",
  weekly_digest_enabled: true,
  alert_email_enabled: true,
};

export function AccountSection() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<ProfileFields>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);

  // Email change
  const [newEmail, setNewEmail] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);

  // Password change
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Delete
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("profiles")
        .select("full_name, avatar_url, weekly_digest_enabled, alert_email_enabled")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data) {
        setProfile({
          full_name: data.full_name ?? "",
          avatar_url: data.avatar_url ?? "",
          weekly_digest_enabled: data.weekly_digest_enabled ?? true,
          alert_email_enabled: data.alert_email_enabled ?? true,
        });
      }
      setLoading(false);
    })();
  }, [user]);

  const saveProfile = async () => {
    if (!user) return;
    setSavingProfile(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: profile.full_name.trim() || null,
        avatar_url: profile.avatar_url.trim() || null,
      })
      .eq("user_id", user.id);
    setSavingProfile(false);
    if (error) toast.error("Could not save profile");
    else toast.success("Profile updated");
  };

  const savePrefs = async (next: Partial<ProfileFields>) => {
    if (!user) return;
    const merged = { ...profile, ...next };
    setProfile(merged);
    setSavingPrefs(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        weekly_digest_enabled: merged.weekly_digest_enabled,
        alert_email_enabled: merged.alert_email_enabled,
      })
      .eq("user_id", user.id);
    setSavingPrefs(false);
    if (error) toast.error("Could not save preferences");
  };

  const changeEmail = async () => {
    const trimmed = newEmail.trim();
    if (!trimmed || !/^\S+@\S+\.\S+$/.test(trimmed)) {
      toast.error("Enter a valid email");
      return;
    }
    setEmailLoading(true);
    const { error } = await supabase.auth.updateUser(
      { email: trimmed },
      { emailRedirectTo: `${window.location.origin}/settings` },
    );
    setEmailLoading(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Check both inboxes — confirmation links sent");
      setNewEmail("");
    }
  };

  const changePassword = async () => {
    if (newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords don't match");
      return;
    }
    setPasswordLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPasswordLoading(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Password updated");
      setNewPassword("");
      setConfirmPassword("");
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const deleteAccount = async () => {
    setDeleting(true);
    const { error } = await supabase.functions.invoke("delete-account");
    setDeleting(false);
    if (error) {
      toast.error("Failed to delete account");
      return;
    }
    await supabase.auth.signOut();
    toast.success("Account deleted");
    navigate("/");
  };

  if (loading) {
    return (
      <Card className="glass-card p-12 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
      </Card>
    );
  }

  const initials = (profile.full_name || user?.email || "?")
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="space-y-6">
      {/* Profile */}
      <div className="space-y-2">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground font-medium px-1">
          Profile
        </h2>
        <Card className="glass-card p-5 space-y-5">
          <div className="flex items-center gap-4">
            <Avatar className="w-16 h-16">
              <AvatarImage src={profile.avatar_url || undefined} alt="" />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {profile.full_name || "Unnamed"}
              </p>
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="full_name" className="text-xs text-muted-foreground">
                Full name
              </Label>
              <Input
                id="full_name"
                value={profile.full_name}
                onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
                placeholder="Your name"
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="avatar_url" className="text-xs text-muted-foreground">
                Avatar URL
              </Label>
              <Input
                id="avatar_url"
                value={profile.avatar_url}
                onChange={(e) => setProfile({ ...profile, avatar_url: e.target.value })}
                placeholder="https://…"
                maxLength={500}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={saveProfile} disabled={savingProfile} size="sm">
              {savingProfile && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
              <UserIcon className="w-3.5 h-3.5 mr-1.5" /> Save profile
            </Button>
          </div>
        </Card>
      </div>

      {/* Email */}
      <div className="space-y-2">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground font-medium px-1">
          Email address
        </h2>
        <Card className="glass-card p-5 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Current email</Label>
            <div className="flex items-center gap-2 text-sm">
              <Mail className="w-3.5 h-3.5 text-muted-foreground" />
              <span>{user?.email}</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new_email" className="text-xs text-muted-foreground">
              New email
            </Label>
            <div className="flex gap-2">
              <Input
                id="new_email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="you@example.com"
              />
              <Button onClick={changeEmail} disabled={emailLoading || !newEmail}>
                {emailLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Update"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              You'll receive a confirmation link at both the old and new addresses.
            </p>
          </div>
        </Card>
      </div>

      {/* Password */}
      <div className="space-y-2">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground font-medium px-1">
          Password
        </h2>
        <Card className="glass-card p-5 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="new_password" className="text-xs text-muted-foreground">
                New password
              </Label>
              <Input
                id="new_password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm_password" className="text-xs text-muted-foreground">
                Confirm
              </Label>
              <Input
                id="confirm_password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={changePassword}
              disabled={passwordLoading || !newPassword || !confirmPassword}
              size="sm"
            >
              {passwordLoading && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
              <KeyRound className="w-3.5 h-3.5 mr-1.5" /> Update password
            </Button>
          </div>
        </Card>
      </div>

      {/* Notifications */}
      <div className="space-y-2">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground font-medium px-1">
          Email notifications
        </h2>
        <Card className="glass-card p-5 space-y-4">
          <PrefRow
            icon={<Bell className="w-3.5 h-3.5 text-primary" />}
            label="Price & signal alerts"
            hint="Emails when one of your alerts or watchlist tickers fires."
            checked={profile.alert_email_enabled}
            onChange={(v) => savePrefs({ alert_email_enabled: v })}
            disabled={savingPrefs}
          />
          <PrefRow
            icon={<Mail className="w-3.5 h-3.5 text-primary" />}
            label="Weekly digest"
            hint="A Monday morning summary of your watchlist, portfolio, and top signals."
            checked={profile.weekly_digest_enabled}
            onChange={(v) => savePrefs({ weekly_digest_enabled: v })}
            disabled={savingPrefs}
          />
        </Card>
      </div>

      {/* Danger zone */}
      <div className="space-y-2">
        <h2 className="text-xs uppercase tracking-wider text-destructive/80 font-medium px-1">
          Account actions
        </h2>
        <Card className="p-5 border-2 border-destructive/30 bg-destructive/5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Sign out</p>
              <p className="text-xs text-muted-foreground">End your session on this device.</p>
            </div>
            <Button variant="outline" size="sm" onClick={signOut}>
              <LogOut className="w-3.5 h-3.5 mr-1.5" /> Sign out
            </Button>
          </div>

          <div className="border-t border-destructive/20 pt-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-destructive">Delete account</p>
              <p className="text-xs text-muted-foreground">
                Permanently remove your account, watchlists, alerts, virtual positions, and
                subscription record. This cannot be undone.
              </p>
            </div>
            <AlertDialog onOpenChange={() => setDeleteConfirm("")}>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This is permanent. All of your data will be erased and active subscriptions
                    cannot be recovered. Type <strong>DELETE</strong> to confirm.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <Input
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  placeholder="DELETE"
                  autoComplete="off"
                />
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={deleteConfirm !== "DELETE" || deleting}
                    onClick={deleteAccount}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {deleting && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
                    Permanently delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </Card>
      </div>
    </div>
  );
}

function PrefRow({
  icon,
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-0.5 flex-1">
        <Label className="text-sm flex items-center gap-2">
          {icon} {label}
        </Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}
