import type { NarrativePreset } from "./types";

export const narrativePresetLabels: Record<NarrativePreset, string> = {
  none: "原作优先",
  "cultivation-conquest": "修仙 · 权谋 · 征服感",
};

export function narrativePresetPrompt(preset: NarrativePreset, adultContent: boolean): string {
  if (preset === "none") return "全局叙事预设：原作优先。除世界书和用户明确设置外，不额外加入题材套路。";
  return `全局叙事预设：修仙 · 权谋 · 征服感 · 成人氛围。
- 以宗门、境界、资源、契约、道心、因果和势力博弈构成修仙世界的推进动力；修炼和权力变化必须有代价与过程。
- 征服感来自实力、名望、领地、秘密、谈判和长期关系反转，不等于让角色失去意志，也不等于强迫亲密关系。
- 主要角色默认是成年人。可以有克制的暧昧、双修、疗伤、灵契、闭关和成人关系氛围，但它们必须服务于人物动机和剧情，不把每一幕都写成情色场景。
- 任何亲密或情色发展都要基于双方明确选择、持续互动或合理契约；角色可以拒绝、索取代价、利用玩家或改变立场。
- 不得用这个预设覆盖原作时代、人物性格、关系边界、剧情事实或角色不知道的信息。
- 成人内容当前状态：${adultContent ? "允许在剧情自然发展时出现" : "关闭，不主动生成成人内容"}。`;
}
