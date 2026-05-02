import { redirect } from 'next/navigation';

export default function AssignmentsIndexPage() {
  // Default tab is "today". The layout still runs first and applies the
  // role-based access guard before this redirect happens.
  redirect('/assignments/today');
}
