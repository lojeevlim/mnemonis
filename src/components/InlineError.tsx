export function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs text-rose-400">
      {message}
    </p>
  );
}
