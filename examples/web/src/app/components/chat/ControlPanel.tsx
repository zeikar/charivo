import { MotionExpressionPanel } from "./MotionExpressionPanel";

type ControlPanelProps = {
  onPlayExpression: (expressionId: string) => void;
  onPlayMotion: (group: string, index: number) => void;
  getAvailableExpressions: () => string[];
  getAvailableMotionGroups: () => Record<string, number>;
};

export function ControlPanel({
  onPlayExpression,
  onPlayMotion,
  getAvailableExpressions,
  getAvailableMotionGroups,
}: ControlPanelProps) {
  return (
    <div className="absolute bottom-4 left-4 md:left-6 z-10 max-w-xs">
      <div className="bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <MotionExpressionPanel
          onPlayExpression={onPlayExpression}
          onPlayMotion={onPlayMotion}
          getAvailableExpressions={getAvailableExpressions}
          getAvailableMotionGroups={getAvailableMotionGroups}
        />
      </div>
    </div>
  );
}
