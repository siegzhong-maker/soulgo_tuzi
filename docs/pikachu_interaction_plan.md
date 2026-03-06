# Pikachu Interaction Optimization Plan

## Problem Analysis

The user reported that when clicking the bed to sleep or when the AI generates a sleep action, the "lying down" animation (GIF) is not called.

Upon code inspection, we found two main issues:

1.  **Animation Truncation**:
    The code currently limits the "rest" animation (`flog_xiuxi`) to only the first **6 frames**.
    The actual asset folder (`比卡丘动画导出/休息/`) contains **24 frames** (`flog_xiuxi_001.png` to `flog_xiuxi_024.png`).
    The "lying down" motion likely occurs in the later frames, which are never played.

2.  **Position Reset Logic**:
    When the pet moves to a hotspot (like the bed), the `walkPetAlongPath` function is called with `resetToDefault: true`.
    This causes the pet to walk to the bed, play the animation (truncated) for a few seconds, and then **teleport back to the default position** (center of the room).
    For a "sleep" action, the pet should remain on the bed until woken up.

## Optimization Plan

### 1. Fix Animation Frames
Update the `makeFrames` calls in `petAnimationStates` to use the correct number of frames for all animations.

-   **Rest (`flog_xiuxi`)**: Increase from 6 to **24** frames.
-   **Interact (`flog_hudong`)**: Increase from 6 to **24** frames (if applicable).
-   **Wait (`flog_dengdai`)**: Increase from 6 to **24** frames.
-   **Observe (`flog_guancha`)**: Increase from 6 to **24** frames.
-   **Idle (`frog_idle`)**: Increase from 6 to **24** frames.

### 2. Improve "Go to Bed" Logic
Modify the movement logic to allow the pet to stay at the target location (bed) when sleeping.

-   **Update `walkPetAlongPath` / `movePetToSpot`**:
    Ensure `resetToDefault` logic respects the passed option and doesn't force a reset if the action requires staying (like sleeping).

-   **Update `hotspotBed` Click Handler**:
    Change `resetToDefault: true` to `resetToDefault: false` so the pet stays on the bed.

-   **Update AI Decision Handler**:
    When the AI intent is `go_to_bed_and_rest` (mapped to `bed` hotspot), ensure `resetToDefault` is set to `false`.

### 3. State Management
Ensure that when the pet wakes up (from `REST` to `IDLE` or `INTERACT`), it properly resets its position to the center if it was sleeping on the bed.
(The current `setPetState` logic for waking up might need to check if the pet is at the bed and walk it back, or just reset position).
For now, `walkPetAlongPath` with `resetToDefault: false` means the pet stays there.
If we want it to come back when waking up, we might need a "wake up and return" logic.
However, for simplicity, we can let the next movement (e.g., "wander" or "go to pot") handle the movement from the current position (bed). `walkPetAlongPath` calculates path from *current* position?
Let's check `walkPetAlongPath`:
It takes `pathPoints`. It doesn't calculate path from current position automatically unless the path points start from current position.
The `buildPathToHotspot` function usually assumes starting from center or specific waypoints.
If the pet is at the bed, and we want it to go to the pot, the path might need to be adjusted.
But `walkPetAlongPath` just moves the DOM element.
If `resetToDefault` is false, the element stays at bed coordinates.
The next animation/movement should work fine as long as the path generation doesn't assume the pet is at `0,0` (or default).
Wait, `petAvatarRoom` uses absolute positioning (`bottom`, `left`).
If we start a new `walkPetAlongPath`, it starts from current position?
`walkPetAlongPath` logic:
```javascript
            const point = pathPoints[index];
            if (point && typeof point.bottom === 'string' && typeof point.left === 'string') {
                petAvatarRoom.style.bottom = point.bottom;
                petAvatarRoom.style.left = point.left;
            }
```
It just jumps to the first point in `pathPoints`.
So if `pathPoints` assumes start from center, the pet will teleport from bed to center then walk.
This is a known limitation of simple path systems.
Given the current scope, keeping it simple (teleport to start of next path) is acceptable, or we can just let it be.
The priority is fixing the "sleeping on bed" experience.

## Execution Steps

1.  **Edit `index.html`**:
    -   Update `petAnimationStates` frame counts.
    -   Update `hotspotBed` event listener to set `resetToDefault: false`.
    -   Update `applyBehaviorDecision` to conditionally set `resetToDefault`.
