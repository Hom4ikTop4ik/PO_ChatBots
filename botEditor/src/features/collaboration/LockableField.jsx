import React from "react";
import PropTypes from "prop-types";
import { useCollaboration } from "./CollaborationContext";

export function LockableField({
  blockId,
  fieldName,
  as = "input",
  value,
  onChange,
  onFocus,
  onBlur,
  children,
  ...rest
}) {
  const collab = useCollaboration();
  const lockedByOther = collab.enabled
    ? collab.isFieldLockedByOther(blockId, fieldName)
    : null;
  const owner = lockedByOther ? collab.getParticipant(lockedByOther.locked_by) : null;
  const isPending = collab.enabled && collab.isFieldPending(blockId, fieldName);

  const handleFocus = (e) => {
    if (collab.enabled) collab.acquireLock(blockId, fieldName);
    if (onFocus) onFocus(e);
  };

  const handleBlur = (e) => {
    if (collab.enabled) collab.releaseLock(blockId, fieldName);
    if (onBlur) onBlur(e);
  };

  const isReadOnly = Boolean(lockedByOther);
  const Tag = as;

  const fieldElement = (
    <Tag
      {...rest}
      value={value ?? ""}
      onChange={isReadOnly ? undefined : onChange}
      onFocus={isReadOnly ? undefined : handleFocus}
      onBlur={isReadOnly ? undefined : handleBlur}
      readOnly={isReadOnly}
      disabled={isReadOnly && as === "select" ? true : rest.disabled}
      style={{
        ...(rest.style || {}),
        ...(isReadOnly
          ? {
              background: "#f0f0f0",
              borderColor: owner?.color || "#999",
              cursor: "not-allowed",
            }
          : {}),
        ...(isPending ? { borderColor: "#aaa", borderStyle: "dashed" } : {}),
      }}
    >
      {children}
    </Tag>
  );

  if (!isReadOnly) return fieldElement;

  return (
    <>
      {fieldElement}
      <div
        style={{
          fontSize: 11,
          marginTop: 2,
          color: owner?.color || "#666",
        }}
      >
        Редактирует {owner?.display_name || `пользователь #${lockedByOther.locked_by}`}
      </div>
    </>
  );
}

LockableField.propTypes = {
  blockId: PropTypes.string.isRequired,
  fieldName: PropTypes.string.isRequired,
  as: PropTypes.oneOf(["input", "textarea", "select"]),
  value: PropTypes.any,
  onChange: PropTypes.func,
  onFocus: PropTypes.func,
  onBlur: PropTypes.func,
  children: PropTypes.node,
};

export default LockableField;
