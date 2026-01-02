-- Add DELETE policy for profiles table to allow users to delete their own profile
-- This addresses GDPR/CCPA "right to be forgotten" requirements

CREATE POLICY "Users can delete their own profile"
ON public.profiles
FOR DELETE
USING (auth.uid() = user_id);