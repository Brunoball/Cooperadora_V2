import { useCallback, useState } from "react";

export function useVentasFeedback() {
  const [feedbackState, setFeedbackState] = useState(null);
  const showFeedback = useCallback((type, message) => setFeedbackState({ type, message }), []);
  const clearFeedback = useCallback(() => setFeedbackState(null), []);
  return { feedbackState, showFeedback, clearFeedback };
}
