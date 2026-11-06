import React from "react";
import { STORY_SOURCE_NOTE } from "../shared/kaiStorySourceInformation.js";

// Presentation only. Source flags and style preferences are deliberately not
// props: neither may change controls, actions, or whether this note is shown.
export default function StorySourceInformation() {
  return React.createElement("p", { className: "small text-muted my-2", "data-story-source-information": "" }, STORY_SOURCE_NOTE);
}
