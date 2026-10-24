/**
 * English copy — the dictionary every other tag falls back to.
 *
 * The tag is `en-US` because that is the tag the shared card machinery answers
 * under: `mergeDictionaries` merges **per locale**, so a plugin that names its
 * dictionary `en` while the shared half says `en-US` would have its copy
 * invisible the moment the page resolves `en-US`, and the dialog's own controls
 * would answer nothing. The whole dictionary set therefore stands under one tag,
 * the shared keys underneath it and the plugin's wording winning any collision.
 *
 * Every string the card renders lives here; the block itself stays copy-free.
 * What is **not** here is anything about a running connection: the profile and
 * the executable one runs with are the manager's card's copy, not this row's.
 */
export const enUS = {
    title: "Docker MCP Toolkit",
    description: "The profiles and executables a Docker MCP Toolkit connection picks from",

    summaryProfiles: "Profiles",
    summaryExecutables: "Executables",

    profileIdLabel: "Profile id",
    profileNameLabel: "Display name",
    profileRows: "Saved profiles",
    profileEmpty: "No profiles saved yet. Use “Fetch profiles” to add the ones this gateway can see.",
    addProfile: "Add profile",

    executableIdLabel: "Executable path",
    executableNameLabel: "Display name",
    executableRows: "Saved executables",
    executableEmpty: "No executables saved. Use “Fetch executables” to add the docker CLI this gateway can run.",
    addExecutable: "Add executable",

    removeEntry: "Remove",
    namePlaceholder: "Display name",

    fetchProfiles: "Fetch profiles",
    fetchExecutables: "Fetch executables",
    dialogProfilesTitle: "Choose profiles to add",
    dialogProfilesDescription: "These are the profiles the gateway can see. Choose the ones to save.",
    dialogExecutablesTitle: "Choose executables to add",
    dialogExecutablesDescription: "These are the docker executables found on this machine. Choose the ones to save.",
    searchProfiles: "Search profiles",
    searchExecutables: "Search executables",

    // Drawn by the shared dialog. `cancel`, `close` and `addSelected` come from
    // the shared dictionary; `selectAll`, `dialogEmpty` and `candidateSaved` are
    // not shared at all, so they ride here — the wording is a catalog's own.
    selectAll: "Select all",
    dialogEmpty: "Nothing matches your search.",
    candidateSaved: "Saved"
};
