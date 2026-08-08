import { useNavigate } from 'react-router-dom';

import { ScrollArea } from '../components/AppShell.tsx';
import { EmptyState } from '../components/Feedback.tsx';

export function NotFoundScreen(): React.JSX.Element {
  const navigate = useNavigate();
  return (
    <ScrollArea>
      <EmptyState
        title="הדף הזה לא קיים"
        message="אולי הקישור ישן, או שהתחנה עברה מקום. אפשר לחזור לאילן ולהמשיך משם."
        actionLabel="חזרה לאילן"
        onAction={() => navigate('/')}
      />
    </ScrollArea>
  );
}
