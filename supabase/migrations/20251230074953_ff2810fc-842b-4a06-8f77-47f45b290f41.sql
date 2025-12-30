-- Add DELETE policy for prediction_runs so users can remove their own predictions (privacy/GDPR compliance)
CREATE POLICY "Users can delete their own predictions"
ON public.prediction_runs
FOR DELETE
USING (auth.uid() = user_id);