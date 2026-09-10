export type RoomSaveTarget = "local" | "cloud";

export type RoomSaveTargetOptions = {
  hasExistingRoom: boolean;
  existingRoomSource?: "local" | "backend";
  cloudMode: boolean;
  hasRemoteSelection: boolean;
};

export const resolveRoomSaveTarget = (options: RoomSaveTargetOptions): RoomSaveTarget => {
  if (options.hasExistingRoom) {
    return options.existingRoomSource === "backend" ? "cloud" : "local";
  }
  return options.cloudMode && options.hasRemoteSelection ? "cloud" : "local";
};
