import React from "react";

export function EventsRouter({ route, children, ...rest }) {
  const raw = (route || "#/events").split("?")[0];
  const activePath = raw.startsWith("#/events/") ? "#/events" : raw;
  const childArray = React.Children.toArray(children);
  const match = childArray.find((child) => child.props.path === activePath);
  if (!match) {
    const fallback = childArray.find((child) => child.props.path === "#/events");
    return fallback ? React.cloneElement(fallback, rest) : null;
  }
  return React.cloneElement(match, rest);
}
