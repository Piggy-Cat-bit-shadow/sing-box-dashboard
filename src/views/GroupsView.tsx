import { useEffect, useRef, useState } from "react";

import { proxyDisplayType, urlTestDelayTone } from "../api/format";
import { useStream } from "../api/stream";
import { useApi } from "../app/context";
import { showError } from "../app/errorStore";
import { usePendingValue } from "../app/hooks";
import { useI18n } from "../app/i18n";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import { StreamStates } from "../components/StreamBanner";
import { Badge, Card, IconButton, MenuItem, Spinner, useContextMenu } from "../components/ui";
import type { Group, GroupItem } from "../gen/daemon/started_service_pb";
import styles from "./GroupsView.module.css";
import { cx } from "../lib/cx";
import { SelectionLedger } from "../lib/selectionLedger";

export function GroupsView() {
  const api = useApi();
  const { t } = useI18n();
  const groups = useStream(api.groups);

  return (
    <div className="page">
      <PageHeader title={t("Groups")} />
      <StreamStates
        snapshot={groups}
        loaded={groups.data.loaded}
        empty={groups.data.groups.length === 0}
        emptyIcon="folder"
        emptyMessage={t("Empty groups")}
      />
      {groups.data.groups.map((group) => (
        <GroupCard key={group.tag} group={group} />
      ))}
    </div>
  );
}

function GroupCard(props: { group: Group }) {
  const api = useApi();
  const { t } = useI18n();
  const group = props.group;
  const [testing, setTesting] = useState(false);
  const [expanded, setExpandOverride] = usePendingValue(group.isExpand);
  // The latest selection attempt for this group. A tag cannot tell two attempts apart, so the
  // answer is settled by the request id the daemon echoes.
  const selectionLedger = useRef(new SelectionLedger());
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const selected = pendingSelection ?? group.selected;

  useEffect(() => {
    // The stream caught up with the member the user picked: the optimistic overlay can go.
    if (pendingSelection !== null && group.selected === pendingSelection) {
      setPendingSelection(null);
    }
  }, [group.selected, pendingSelection]);

  const toggleExpand = () => {
    const next = !expanded;
    setExpandOverride(next);
    api.setGroupExpand(group.tag, next).catch(() => setExpandOverride(null));
  };

  const runURLTest = () => {
    setTesting(true);
    api
      .urlTest(group.tag)
      .catch(showError)
      .finally(() => setTesting(false));
  };

  const selectItem = (item: GroupItem) => {
    if (!group.selectable || item.tag === selected) {
      return;
    }
    const snapshot = selectionLedger.current.begin(group.tag, item.tag);
    setPendingSelection(item.tag);
    api
      .selectOutboundWithRequest(group.tag, item.tag, snapshot.requestId, snapshot.expectedRevision)
      .then((response) => {
        const settlement = selectionLedger.current.settle(snapshot, {
          requestId: response.requestId,
          appliedOutboundTag: response.appliedOutboundTag,
          appliedRevision: response.appliedRevision,
          stale: response.stale,
        });
        if (settlement.kind === "applied") {
          // Follow the member the group HOLDS, not the one that was requested.
          setPendingSelection(settlement.outboundTag);
        } else if (settlement.kind === "unconfirmed" || settlement.kind === "failed") {
          setPendingSelection(null);
        }
        // ignored-older-* : a newer attempt owns this group, so leave its pending value alone.
      })
      .catch((error: unknown) => {
        selectionLedger.current.fail(snapshot, String(error));
        setPendingSelection(null);
        showError(error);
      });
  };

  return (
    <div className={cx(styles.groupCard, expanded && styles.expanded)}>
      <Card
        title={
          <>
            {group.tag}
            <span style={{ marginLeft: 8, color: "var(--text-faint)", fontWeight: 500 }}>
              {proxyDisplayType(group.type)}
            </span>
          </>
        }
        actions={
          <>
            <Badge>{group.items.length}</Badge>
            <IconButton title={t("URL test")} onClick={runURLTest} disabled={testing}>
              {testing ? <Spinner /> : <Icon name="speed" />}
            </IconButton>
            <IconButton
              title={expanded ? t("Collapse") : t("Expand")}
              onClick={toggleExpand}
            >
              <Icon name={expanded ? "expand_less" : "expand_more"} />
            </IconButton>
          </>
        }
      >
        {expanded ? (
          <div className={styles.groupItems}>
            {group.items.map((item) => (
              <GroupItemCard
                key={item.tag}
                item={item}
                selected={item.tag === selected}
                onSelect={() => selectItem(item)}
              />
            ))}
          </div>
        ) : (
          <div className={styles.groupDots}>
            {group.items.map((item) => {
              const tone = item.urlTestDelay > 0 ? urlTestDelayTone(item.urlTestDelay) : "";
              return (
                <span
                  key={item.tag}
                  className={cx(styles.groupDot, styles[tone], item.tag === selected && styles.selected)}
                  title={`${item.tag}${item.urlTestDelay > 0 ? ` (${item.urlTestDelay}ms)` : ""}`}
                />
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function GroupItemCard(props: { item: GroupItem; selected: boolean; onSelect: () => void }) {
  const api = useApi();
  const { t } = useI18n();
  const item = props.item;
  const menu = useContextMenu(
    <MenuItem icon="speed" onSelect={() => api.urlTest(item.tag).catch(showError)}>
      {t("URL test")}
    </MenuItem>,
  );

  return (
    <>
      <button
        type="button"
        className={cx(styles.groupItem, props.selected && styles.selected)}
        onClick={props.onSelect}
        {...menu.triggerProps}
      >
        <span className={styles.itemTag}>{item.tag}</span>
        <span className={styles.itemMeta}>
          <span>{proxyDisplayType(item.type)}</span>
          {item.urlTestDelay > 0 && (
            <span className={cx(styles.delayText, styles[urlTestDelayTone(item.urlTestDelay)])}>
              {item.urlTestDelay}ms
            </span>
          )}
        </span>
      </button>
      {menu.element}
    </>
  );
}
