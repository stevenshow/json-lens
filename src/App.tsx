import { useState, ReactNode, useEffect, useRef } from "react";
import "./App.css";
// Use the plugin imports for Tauri v2
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
// Import dnd-kit components
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Define a Tab type for our tabs
type JsonTab = {
  id: string;
  name: string;
  jsonInput: string;
  parsedJson: Record<string, unknown> | unknown[] | null;
  isEditing: boolean;
  searchTerm: string;
};

// CollapsibleJSON component for rendering expandable JSON objects
const CollapsibleJSON = ({
  data,
  searchTerm,
  onSwitchToEdit,
  onToggleSearch,
  showSearchBar,
}: {
  data: Record<string, unknown> | unknown[];
  searchTerm: string;
  onSwitchToEdit: () => void;
  onToggleSearch: () => void;
  showSearchBar: boolean;
}) => {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [matchCount, setMatchCount] = useState<number>(0);
  const [currentMatchIndex, setCurrentMatchIndex] = useState<number>(0);
  const [matchPositions, setMatchPositions] = useState<string[]>([]);
  const [showTopButton, setShowTopButton] = useState<boolean>(false);
  const matchRefs = useRef<Map<string, HTMLElement>>(new Map());
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Effect to reset match navigation when search term changes
  useEffect(() => {
    setCurrentMatchIndex(0);
    matchRefs.current = new Map();
  }, [searchTerm]);

  // Add scroll event listener to show/hide top button
  useEffect(() => {
    // Find the json-container - it's the parent of our component
    const jsonContainer = containerRef.current?.closest(".json-container");

    const handleScroll = (e: Event) => {
      const target = e.target as HTMLElement;
      setShowTopButton(target.scrollTop > 200);
    };

    if (jsonContainer) {
      jsonContainer.addEventListener("scroll", handleScroll);

      // Initial check
      setShowTopButton(jsonContainer.scrollTop > 200);
    }

    return () => {
      if (jsonContainer) {
        jsonContainer.removeEventListener("scroll", handleScroll);
      }
    };
  }, [data]); // Re-attach when data changes since container might change

  // Function to get all paths in the JSON structure
  const getAllPaths = (value: unknown, path = "root"): string[] => {
    const paths: string[] = [path];

    if (value && typeof value === "object") {
      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          paths.push(...getAllPaths(item, `${path}.${index}`));
        });
      } else {
        Object.entries(value).forEach(([key, val]) => {
          paths.push(...getAllPaths(val, `${path}.${key}`));
        });
      }
    }

    return paths;
  };

  // Expand all nodes initially
  useEffect(() => {
    const allPaths = getAllPaths(data);
    setExpandedNodes(new Set(allPaths));
  }, [data]);

  // Collapse all nodes
  const collapseAll = () => {
    setExpandedNodes(new Set());
  };

  // Expand all nodes
  const expandAll = () => {
    const allPaths = getAllPaths(data);
    setExpandedNodes(new Set(allPaths));
  };

  // Scroll to top of the component
  const scrollToTop = () => {
    const jsonContainer = containerRef.current?.closest(".json-container");
    if (jsonContainer) {
      jsonContainer.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const toggleNode = (path: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedNodes(newExpanded);
  };

  // Highlight text that matches search term
  const highlightMatches = (
    text: string,
    path: string,
    type: "key" | "string" | "primitive"
  ): ReactNode => {
    if (!searchTerm.trim()) return text;

    // Use case-insensitive regex for finding matches
    const searchRegex = new RegExp(`(${escapeRegExp(searchTerm)})`, "gi");
    const parts = String(text).split(searchRegex);

    if (parts.length <= 1) return text;

    // Find all matches within this text
    const matches: { start: number; end: number; text: string }[] = [];
    let match;
    const regex = new RegExp(escapeRegExp(searchTerm), "gi");

    // Reset regex index
    regex.lastIndex = 0;

    // Find all matches and their positions
    while ((match = regex.exec(text)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0], // Store the actual matched text
      });
    }

    // Create array to store highlighted parts
    const highlightedParts: React.ReactNode[] = [];
    let lastIndex = 0;

    // Process each match
    matches.forEach((match, index) => {
      // Add text before the match
      if (match.start > lastIndex) {
        highlightedParts.push(text.substring(lastIndex, match.start));
      }

      // Generate a unique ID for this match using the actual matched text
      const matchId = `${path}:${type}:${index}:${match.text.toLowerCase()}`;

      // Check if this match is the current one
      const isCurrentMatch =
        matchPositions.length > 0 &&
        currentMatchIndex >= 0 &&
        currentMatchIndex < matchPositions.length &&
        matchPositions[currentMatchIndex] === matchId;

      // Add the highlighted match
      highlightedParts.push(
        <mark
          key={matchId}
          className={
            isCurrentMatch
              ? "search-highlight current-match"
              : "search-highlight"
          }
          ref={(el) => registerMatchRef(matchId, el)}
          data-match-id={matchId}
        >
          {match.text}
        </mark>
      );

      lastIndex = match.end;
    });

    // Add any remaining text after the last match
    if (lastIndex < text.length) {
      highlightedParts.push(text.substring(lastIndex));
    }

    return highlightedParts;
  };

  // Find all paths where search term matches
  useEffect(() => {
    if (!searchTerm.trim()) {
      setMatchCount(0);
      setMatchPositions([]);
      setCurrentMatchIndex(0);
      return;
    }

    // Clear previous refs when search term changes
    matchRefs.current.clear();

    const searchLower = searchTerm.toLowerCase();
    const matches = new Set<string>();
    const pathsToExpand = new Set<string>();
    let count = 0;
    const positions: string[] = [];

    const findMatches = (value: unknown, path: string) => {
      // Check string values
      if (
        typeof value === "string" &&
        value.toLowerCase().includes(searchLower)
      ) {
        matches.add(path);
        // Count occurrences within this string
        const regex = new RegExp(escapeRegExp(searchLower), "gi");
        const text = value;

        // Reset regex index
        regex.lastIndex = 0;

        // Find each occurrence and record its exact match
        let match;
        let matchIndex = 0;
        while ((match = regex.exec(text)) !== null) {
          const exactMatch = match[0].toLowerCase();
          positions.push(`${path}:string:${matchIndex}:${exactMatch}`);
          matchIndex++;
        }

        count += matchIndex;

        // Add all parent paths to expand
        let currentPath = path;
        while (currentPath.includes(".")) {
          currentPath = currentPath.substring(0, currentPath.lastIndexOf("."));
          pathsToExpand.add(currentPath);
        }
      }

      // Check object keys - similar updates for keys
      if (typeof value === "object" && value !== null) {
        if (Array.isArray(value)) {
          value.forEach((item, index) => {
            findMatches(item, `${path}.${index}`);
          });
        } else {
          Object.entries(value).forEach(([key, val]) => {
            // Check if key matches search term
            if (key.toLowerCase().includes(searchLower)) {
              matches.add(`${path}.${key}`);

              // Find each occurrence in the key
              const regex = new RegExp(escapeRegExp(searchLower), "gi");
              const text = key;

              // Reset regex index
              regex.lastIndex = 0;

              // Find each match with its exact text
              let match;
              let matchIndex = 0;
              while ((match = regex.exec(text)) !== null) {
                const exactMatch = match[0].toLowerCase();
                positions.push(
                  `${path}.${key}:key:${matchIndex}:${exactMatch}`
                );
                matchIndex++;
              }

              count += matchIndex;
              pathsToExpand.add(path);
            }
            findMatches(val, `${path}.${key}`);
          });
        }
      }

      // Check primitive values - same update for primitives
      if (typeof value === "number" || typeof value === "boolean") {
        const strValue = String(value);
        if (strValue.toLowerCase().includes(searchLower)) {
          matches.add(path);

          // Find each occurrence
          const regex = new RegExp(escapeRegExp(searchLower), "gi");
          const text = strValue;

          // Reset regex index
          regex.lastIndex = 0;

          // Find each match with its exact text
          let match;
          let matchIndex = 0;
          while ((match = regex.exec(text)) !== null) {
            const exactMatch = match[0].toLowerCase();
            positions.push(`${path}:primitive:${matchIndex}:${exactMatch}`);
            matchIndex++;
          }

          count += matchIndex;

          // Add all parent paths to expand
          let currentPath = path;
          while (currentPath.includes(".")) {
            currentPath = currentPath.substring(
              0,
              currentPath.lastIndexOf(".")
            );
            pathsToExpand.add(currentPath);
          }
        }
      }
    };

    findMatches(data, "root");
    setMatchCount(count);
    setMatchPositions(positions);

    // Add all matches and paths to expand to expanded nodes
    if (matches.size > 0) {
      const newExpanded = new Set(expandedNodes);
      pathsToExpand.forEach((path) => newExpanded.add(path));
      matches.forEach((path) => {
        // Add parent path of matched value
        const parentPath = path.substring(0, path.lastIndexOf("."));
        newExpanded.add(parentPath);
        newExpanded.add("root"); // Always expand root
      });
      setExpandedNodes(newExpanded);
    }
  }, [searchTerm, data]);

  // Register ref for a match element
  const registerMatchRef = (id: string, element: HTMLElement | null) => {
    if (element && searchTerm.trim() !== "") {
      matchRefs.current.set(id, element);
    }
  };

  // Navigate to next match
  const goToNextMatch = () => {
    if (matchCount === 0) return;

    const nextIndex = (currentMatchIndex + 1) % matchCount;
    setCurrentMatchIndex(nextIndex);

    // Scroll to the match with a small delay to ensure refs are properly registered
    setTimeout(() => {
      const matchId = matchPositions[nextIndex];
      const element = matchRefs.current.get(matchId);

      if (element) {
        // Update current-match class on all highlights
        document.querySelectorAll(".current-match").forEach((el) => {
          el.classList.remove("current-match");
        });
        element.classList.add("current-match");

        element.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        // Try to find the match in the DOM directly as fallback
        const matchElement = document.querySelector(
          `[data-match-id="${matchId}"]`
        );
        if (matchElement) {
          document.querySelectorAll(".current-match").forEach((el) => {
            el.classList.remove("current-match");
          });
          matchElement.classList.add("current-match");
          (matchElement as HTMLElement).scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        } else {
          // Last resort: use index-based approach
          const allHighlights = document.querySelectorAll(".search-highlight");
          if (allHighlights.length > 0) {
            document.querySelectorAll(".current-match").forEach((el) => {
              el.classList.remove("current-match");
            });
            const index = Math.min(nextIndex, allHighlights.length - 1);
            allHighlights[index].classList.add("current-match");
            (allHighlights[index] as HTMLElement).scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          }
        }
      }
    }, 50);
  };

  // Navigate to previous match
  const goToPrevMatch = () => {
    if (matchCount === 0) return;

    const prevIndex = (currentMatchIndex - 1 + matchCount) % matchCount;
    setCurrentMatchIndex(prevIndex);

    // Scroll to the match with a small delay to ensure refs are properly registered
    setTimeout(() => {
      const matchId = matchPositions[prevIndex];
      const element = matchRefs.current.get(matchId);

      if (element) {
        // Update current-match class on all highlights
        document.querySelectorAll(".current-match").forEach((el) => {
          el.classList.remove("current-match");
        });
        element.classList.add("current-match");

        element.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        // Try to find the match in the DOM directly as fallback
        const matchElement = document.querySelector(
          `[data-match-id="${matchId}"]`
        );
        if (matchElement) {
          document.querySelectorAll(".current-match").forEach((el) => {
            el.classList.remove("current-match");
          });
          matchElement.classList.add("current-match");
          (matchElement as HTMLElement).scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        } else {
          // Last resort: use index-based approach
          const allHighlights = document.querySelectorAll(".search-highlight");
          if (allHighlights.length > 0) {
            document.querySelectorAll(".current-match").forEach((el) => {
              el.classList.remove("current-match");
            });
            const index = Math.min(prevIndex, allHighlights.length - 1);
            allHighlights[index].classList.add("current-match");
            (allHighlights[index] as HTMLElement).scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          }
        }
      }
    }, 50);
  };

  // Escape special chars for regex
  const escapeRegExp = (string: string): string => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  };

  const renderValue = (
    value: unknown,
    path: string,
    depth = 0,
    isLast = true,
    keyName?: string
  ): ReactNode => {
    const isExpanded = expandedNodes.has(path);
    const indent = "  ".repeat(depth);
    const comma = isLast ? "" : ",";

    if (value === null) return <span className="json-null">null{comma}</span>;
    if (typeof value === "boolean")
      return (
        <span className="json-boolean">
          {highlightMatches(String(value), path, "primitive")}
          {comma}
        </span>
      );
    if (typeof value === "number")
      return (
        <span className="json-number">
          {highlightMatches(String(value), path, "primitive")}
          {comma}
        </span>
      );
    if (typeof value === "string")
      return (
        <span className="json-string">
          "{highlightMatches(value, path, "string")}"{comma}
        </span>
      );

    if (Array.isArray(value)) {
      if (value.length === 0) return <span>[]{comma}</span>;

      const toggleLabel = keyName ? (
        <>
          <span className="json-key">
            {highlightMatches(`"${keyName}"`, `${path}`, "key")}
          </span>
          <span className="json-colon">:</span>
        </>
      ) : null;

      return (
        <div className="json-block">
          <div className="json-line">
            <span className="json-toggle" onClick={() => toggleNode(path)}>
              {isExpanded ? (
                <span className="toggle-down">▼</span>
              ) : (
                <span className="toggle-right">▶</span>
              )}{" "}
              {toggleLabel}
              <span className={toggleLabel ? "brace" : "brace no-key"}>[</span>
            </span>
            {!isExpanded && <span>...</span>}
          </div>
          {isExpanded && (
            <div className="json-collapsible">
              {value.map((item, index) => (
                <div key={index} className="json-item">
                  {renderValue(
                    item,
                    `${path}.${index}`,
                    depth + 1,
                    index === value.length - 1
                  )}
                </div>
              ))}
            </div>
          )}
          {isExpanded && (
            <div className="json-line">
              {indent}
              <span className="brace">]{comma}</span>
            </div>
          )}
          {!isExpanded && (
            <span className="json-line-end">
              {indent}
              <span className="brace">]{comma}</span>
            </span>
          )}
        </div>
      );
    }

    if (typeof value === "object") {
      const keys = Object.keys(value as object);
      if (keys.length === 0)
        return (
          <span>
            {"{}"}
            {comma}
          </span>
        );

      const toggleLabel = keyName ? (
        <>
          <span className="json-key">
            {highlightMatches(`"${keyName}"`, `${path}`, "key")}
          </span>
          <span className="json-colon">:</span>
        </>
      ) : null;

      return (
        <div className="json-block">
          <div className="json-line">
            <span className="json-toggle" onClick={() => toggleNode(path)}>
              {isExpanded ? (
                <span className="toggle-down">▼</span>
              ) : (
                <span className="toggle-right">▶</span>
              )}{" "}
              {toggleLabel}
              <span className={toggleLabel ? "brace" : "brace no-key"}>
                {"{"}
              </span>
            </span>
            {!isExpanded && <span>...</span>}
          </div>
          {isExpanded && (
            <div className="json-collapsible">
              {keys.map((key, index) => {
                const nestedValue = (value as Record<string, unknown>)[key];
                const isNested =
                  nestedValue !== null && typeof nestedValue === "object";

                if (isNested) {
                  return (
                    <div key={key} className="json-item">
                      {renderValue(
                        nestedValue,
                        `${path}.${key}`,
                        depth + 1,
                        index === keys.length - 1,
                        key
                      )}
                    </div>
                  );
                } else {
                  return (
                    <div key={key} className="json-item">
                      <span className="json-key">
                        {highlightMatches(`"${key}"`, `${path}`, "key")}
                      </span>
                      <span className="json-colon">:</span>{" "}
                      {renderValue(
                        nestedValue,
                        `${path}.${key}`,
                        depth + 1,
                        index === keys.length - 1
                      )}
                    </div>
                  );
                }
              })}
            </div>
          )}
          {isExpanded && (
            <div className="json-line">
              {indent}
              <span className="brace">
                {"}"}
                {comma}
              </span>
            </div>
          )}
          {!isExpanded && (
            <span className="json-line-end">
              {indent}
              <span className="brace">
                {"}"}
                {comma}
              </span>
            </span>
          )}
        </div>
      );
    }

    return (
      <span>
        {String(value)}
        {comma}
      </span>
    );
  };

  return (
    <div ref={containerRef}>
      <div
        style={{
          marginBottom: "8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <button onClick={collapseAll} className="collapse-button">
            Collapse All
          </button>
          <button
            onClick={expandAll}
            className="expand-button"
            style={{ marginLeft: "8px" }}
          >
            Expand All
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center" }}>
          {searchTerm.trim() !== "" && (
            <div className="match-navigation">
              <button
                className="nav-button prev-match"
                onClick={goToPrevMatch}
                disabled={matchCount === 0}
                title="Previous match"
              >
                ↑
              </button>
              <span className="match-count">
                {matchCount > 0
                  ? `${currentMatchIndex + 1}/${matchCount}`
                  : "0"}{" "}
                matches
              </span>
              <button
                className="nav-button next-match"
                onClick={goToNextMatch}
                disabled={matchCount === 0}
                title="Next match"
              >
                ↓
              </button>
            </div>
          )}
          <button
            onClick={onSwitchToEdit}
            className="edit-button"
            style={{ marginLeft: "8px" }}
          >
            Edit
          </button>
          <button
            onClick={onToggleSearch}
            className="search-button"
            style={{ marginLeft: "8px" }}
          >
            {showSearchBar ? "Hide Search" : "Search"}
          </button>
        </div>
      </div>
      <div className="collapsible-json">{renderValue(data, "root")}</div>
      <div
        className={`top-button ${!showTopButton ? "hidden" : ""}`}
        onClick={scrollToTop}
        title="Back to top"
      >
        ↑
      </div>
    </div>
  );
};

// SortableTab component for draggable tabs
const SortableTab = ({
  tab,
  activeTabId,
  closeTab,
  onClick,
  isRenaming,
  onRename,
  onDoubleClick,
}: {
  tab: JsonTab;
  activeTabId: string;
  closeTab: (tabId: string, e: React.MouseEvent) => void;
  onClick: () => void;
  isRenaming: boolean;
  onRename: (newName: string) => void;
  onDoubleClick: () => void;
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: tab.id,
    disabled: isRenaming, // Disable dragging while renaming
  });

  const [editName, setEditName] = useState(tab.name);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input when entering edit mode
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : 0,
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onRename(editName);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditName(tab.name); // Reset to original name
      onRename(tab.name);
    }
  };

  const handleBlur = () => {
    onRename(editName);
  };

  return (
    <div
      ref={setNodeRef}
      className={`tab ${activeTabId === tab.id ? "active" : ""} ${
        isDragging ? "dragging" : ""
      }`}
      onClick={onClick}
      style={style}
      {...(isRenaming ? {} : { ...attributes, ...listeners })}
    >
      {isRenaming ? (
        <input
          ref={inputRef}
          className="tab-name-input"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onClick={(e) => e.stopPropagation()}
          maxLength={30}
        />
      ) : (
        <span className="tab-name" onDoubleClick={onDoubleClick}>
          {tab.name}
        </span>
      )}

      {/* Close button - exclude from drag listeners */}
      <button className="close-tab" onClick={(e) => closeTab(tab.id, e)}>
        ×
      </button>
    </div>
  );
};

function App() {
  // State for tabs and current active tab
  const [tabs, setTabs] = useState<JsonTab[]>([
    {
      id: "tab-" + Date.now(),
      name: "Untitled",
      jsonInput: "",
      parsedJson: null,
      isEditing: true,
      searchTerm: "",
    },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0].id);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);

  // Get active tab data
  const activeTab = tabs.find((tab) => tab.id === activeTabId) || tabs[0];

  // Other state
  const [error, setError] = useState<string>("");
  const [showSearchBar, setShowSearchBar] = useState<boolean>(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // DnD sensors setup
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 5px movement required before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Function to add a new tab
  const addNewTab = () => {
    const newTab: JsonTab = {
      id: "tab-" + Date.now(),
      name: "Untitled",
      jsonInput: "",
      parsedJson: null,
      isEditing: true,
      searchTerm: "",
    };
    setTabs([...tabs, newTab]);
    setActiveTabId(newTab.id);
  };

  // Function to close a tab
  const closeTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent tab activation when closing

    // Don't close the last tab
    if (tabs.length === 1) return;

    const newTabs = tabs.filter((tab) => tab.id !== tabId);
    setTabs(newTabs);

    // If we closed the active tab, activate another tab
    if (tabId === activeTabId) {
      setActiveTabId(newTabs[0].id);
    }

    // If we closed the tab being renamed, cancel renaming
    if (tabId === renamingTabId) {
      setRenamingTabId(null);
    }
  };

  // Start tab rename
  const startRenaming = (tabId: string) => {
    setRenamingTabId(tabId);
  };

  // Complete tab rename
  const completeRename = (tabId: string, newName: string) => {
    setTabs(
      tabs.map((tab) =>
        tab.id === tabId ? { ...tab, name: newName.trim() || "Untitled" } : tab
      )
    );
    setRenamingTabId(null);
  };

  // Handle drag end event from dnd-kit
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setTabs((tabs) => {
        const oldIndex = tabs.findIndex((tab) => tab.id === active.id);
        const newIndex = tabs.findIndex((tab) => tab.id === over.id);

        return arrayMove(tabs, oldIndex, newIndex);
      });
    }
  };

  // Function to update tab data
  const updateActiveTab = (updates: Partial<JsonTab>) => {
    setTabs(
      tabs.map((tab) => (tab.id === activeTabId ? { ...tab, ...updates } : tab))
    );
  };

  // Add keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if in preview mode
      if (!activeTab.isEditing && activeTab.parsedJson) {
        // Listen for Cmd+F (Mac) or Ctrl+F (Windows/Linux)
        if ((e.metaKey || e.ctrlKey) && e.key === "f") {
          e.preventDefault(); // Prevent browser's default search
          setShowSearchBar((prevState) => !prevState); // Toggle search bar

          // If we're showing the search bar, focus it after a short delay
          if (!showSearchBar) {
            setTimeout(() => {
              searchInputRef.current?.focus();
            }, 50);
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeTab.isEditing, activeTab.parsedJson, showSearchBar]);

  // Effect to focus search input when search bar appears
  useEffect(() => {
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [activeTab.searchTerm]);

  // Function to open a JSON file
  const openJsonFile = async () => {
    try {
      // Open a selection dialog for JSON files
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "JSON",
            extensions: ["json"],
          },
        ],
      });

      if (selected) {
        // Read the file content
        const content = await readTextFile(selected as string);

        // Get file name from path
        const fileName =
          (selected as string).split(/[/\\]/).pop() || "Untitled";

        try {
          const parsed = JSON.parse(content);

          // Update active tab with new content
          updateActiveTab({
            name: fileName,
            jsonInput: content,
            parsedJson: parsed,
            isEditing: false,
          });

          setError("");
        } catch (parseError) {
          setError("Failed to parse JSON: " + (parseError as Error).message);
        }
      }
    } catch (fileError) {
      setError("Error opening file: " + (fileError as Error).message);
    }
  };

  // Function to handle JSON input from textarea
  const handleJsonInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const input = e.target.value;

    if (input.trim() === "") {
      updateActiveTab({
        jsonInput: input,
        parsedJson: null,
      });
      setError("");
      return;
    }

    try {
      const parsed = JSON.parse(input);
      updateActiveTab({
        jsonInput: input,
        parsedJson: parsed,
      });
      setError("");
    } catch (parseError) {
      updateActiveTab({
        jsonInput: input,
      });
      setError("Invalid JSON: " + (parseError as Error).message);
    }
  };

  // Function to format JSON for display in the editor
  const formatJson = () => {
    if (activeTab.parsedJson) {
      const formatted = JSON.stringify(activeTab.parsedJson, null, 2);
      updateActiveTab({
        jsonInput: formatted,
      });
    }
  };

  // Function to handle search input
  const handleSearchInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateActiveTab({
      searchTerm: e.target.value,
    });
  };

  // Toggle between JSON viewer and editor
  const toggleView = () => {
    // When switching from edit to preview, only proceed if we have valid JSON
    if (activeTab.isEditing && !activeTab.parsedJson) {
      // Don't switch to view mode if no valid JSON
      return;
    }

    // If switching to edit mode, ensure the JSON is formatted
    if (!activeTab.isEditing) {
      formatJson();
    }

    updateActiveTab({
      isEditing: !activeTab.isEditing,
    });
  };

  // Function to load new JSON (clear current and show editor)
  const loadNewJson = () => {
    updateActiveTab({
      jsonInput: "",
      parsedJson: null,
      isEditing: true,
      searchTerm: "",
    });
    setError("");
  };

  // Function to check if an object is a valid JSON object or array
  const isValidJsonObject = (
    data: unknown
  ): data is Record<string, unknown> | unknown[] => {
    return data !== null && typeof data === "object";
  };

  return (
    <div className="container">
      <div className="card">
        {/* Tab bar with drag-and-drop functionality - always visible */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <div className="tabs-container">
            <SortableContext
              items={tabs.map((tab) => tab.id)}
              strategy={horizontalListSortingStrategy}
            >
              {tabs.map((tab) => (
                <SortableTab
                  key={tab.id}
                  tab={tab}
                  activeTabId={activeTabId}
                  closeTab={closeTab}
                  onClick={() => setActiveTabId(tab.id)}
                  isRenaming={renamingTabId === tab.id}
                  onRename={(newName) => completeRename(tab.id, newName)}
                  onDoubleClick={() => startRenaming(tab.id)}
                />
              ))}
            </SortableContext>

            <button className="new-tab-button" onClick={addNewTab}>
              +
            </button>
          </div>
        </DndContext>

        {/* Action buttons that always show */}
        <div className="json-viewer-header">
          <div className="json-viewer-actions">
            <div className="action-buttons">
              {activeTab.isEditing && (
                <>
                  <button onClick={openJsonFile} className="open-file-button">
                    Open JSON File
                  </button>
                  <button onClick={loadNewJson} className="secondary-button">
                    New JSON
                  </button>
                </>
              )}
              {/* Only show Preview button when in edit mode and valid JSON exists */}
              {activeTab.isEditing && activeTab.parsedJson && (
                <button onClick={toggleView} className="secondary-button">
                  Preview
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Content area */}
        <div className="content-area">
          {/* Editor View */}
          {activeTab.isEditing ? (
            <div className="input-view">
              <textarea
                className="json-input"
                value={activeTab.jsonInput}
                onChange={handleJsonInput}
                placeholder="Paste your JSON here..."
                style={{ flex: 1, height: "100%" }}
              />
              {error && <div className="error-message">{error}</div>}
            </div>
          ) : (
            /* JSON Viewer */
            activeTab.parsedJson &&
            isValidJsonObject(activeTab.parsedJson) && (
              <div className="json-viewer-container">
                {/* Togglable search bar */}
                {showSearchBar && (
                  <div
                    style={{
                      padding: "10px",
                      display: "flex",
                      gap: "10px",
                      marginBottom: "10px",
                      background: "#333",
                      borderRadius: "4px",
                      animation: "fadeIn 0.2s ease-in-out",
                    }}
                  >
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder="Search in JSON..."
                      className="search-input"
                      value={activeTab.searchTerm}
                      onChange={handleSearchInput}
                      style={{
                        flex: 1,
                        padding: "8px",
                        borderRadius: "4px",
                        border: "1px solid #444",
                        background: "#1a1a1a",
                        color: "#fff",
                      }}
                    />
                    <button
                      onClick={() => updateActiveTab({ searchTerm: "" })}
                      style={{
                        padding: "8px",
                        borderRadius: "4px",
                        border: "1px solid #f1fa8c",
                        background: "transparent",
                        color: "#f1fa8c",
                        cursor: "pointer",
                      }}
                    >
                      Clear
                    </button>
                  </div>
                )}
                <div className="json-container">
                  <CollapsibleJSON
                    data={activeTab.parsedJson}
                    searchTerm={activeTab.searchTerm}
                    onSwitchToEdit={toggleView}
                    onToggleSearch={() => {
                      setShowSearchBar(!showSearchBar);
                      // Focus the search input when it appears
                      if (!showSearchBar) {
                        setTimeout(() => {
                          searchInputRef.current?.focus();
                        }, 50);
                      }
                    }}
                    showSearchBar={showSearchBar}
                  />
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
