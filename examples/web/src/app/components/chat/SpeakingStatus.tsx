type SpeakingStatusProps = {
  label?: string;
};

export function SpeakingStatus({ label = "Speaking..." }: SpeakingStatusProps) {
  return (
    <div className="mt-3 p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
      <div className="flex items-center justify-center space-x-2 text-sm text-blue-600 dark:text-blue-400">
        <div className="animate-pulse">🎵</div>
        <span>{label}</span>
      </div>
    </div>
  );
}
