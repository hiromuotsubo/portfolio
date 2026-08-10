"""Deterministic art-direction parameters for Journey V3 Phase 1C."""

CAMERA_SWEEP_PROGRESS = [11.5, 12.0, 13.5, 16.0, 20.0, 22.0, 23.5, 25.0, 28.25, 30.0]

RIVER_STATIONS = [
    # y, center x, half width, bed z
    (2.0, 14.0, 16.0, -1.35),
    (28.0, 11.0, 14.5, -0.72),
    (58.0, 16.0, 13.5, 0.02),
    (92.0, 12.0, 11.8, 0.82),
    (128.0, 3.0, 10.6, 1.72),
    (168.0, -5.0, 9.3, 2.72),
    (212.0, -1.0, 8.0, 3.84),
    (258.0, 5.0, 6.8, 5.02),
    (306.0, 1.0, 5.6, 6.30),
    (348.0, -2.0, 4.8, 7.45),
]

ZONE_COLORS = {
    "ROCK": (0.34, 0.30, 0.27, 1.0),
    "GRASS": (0.28, 0.48, 0.12, 1.0),
    "FOREST": (0.035, 0.18, 0.075, 1.0),
    "SNOW": (0.82, 0.88, 0.9, 1.0),
    "WET": (0.12, 0.28, 0.25, 1.0),
    "FLOWER_POTENTIAL": (0.64, 0.18, 0.52, 1.0),
    "RIVER_EXCLUSION": (0.03, 0.34, 0.55, 1.0),
    "WIND_REACTIVE_VEGETATION": (0.82, 0.55, 0.08, 1.0),
}

CANDIDATES = {
    "A": {
        "label": "Montfort-dominant asymmetric massif",
        "cycle": 1,
        "valley_width_scale": 0.90,
        "mountain_start_y": 36.0,
        "left_peak_y": 172.0,
        "left_primary_height": 105.0,
        "left_shoulder_height": 48.0,
        "right_peak_y": 228.0,
        "right_primary_height": 80.0,
        "right_shoulder_height": 38.0,
        "rear_height": 122.0,
        "rear_peak_bias": -38.0,
        "erosion_strength": 1.15,
        "river_width_scale": 0.94,
        "meadow_width_scale": 0.86,
        "mountain_depth_shift": -4.0,
    },
    "B": {
        "label": "Hero Valley-dominant open valley",
        "cycle": 1,
        "valley_width_scale": 1.27,
        "mountain_start_y": 52.0,
        "left_peak_y": 218.0,
        "left_primary_height": 82.0,
        "left_shoulder_height": 34.0,
        "right_peak_y": 246.0,
        "right_primary_height": 76.0,
        "right_shoulder_height": 32.0,
        "rear_height": 112.0,
        "rear_peak_bias": 18.0,
        "erosion_strength": 0.82,
        "river_width_scale": 1.20,
        "meadow_width_scale": 1.26,
        "mountain_depth_shift": 18.0,
    },
    "HYBRID": {
        "label": "Cycle 2 selected hybrid: Montfort mass with Hero Valley opening",
        "cycle": 2,
        "valley_width_scale": 1.10,
        "mountain_start_y": 46.0,
        "left_peak_y": 198.0,
        "left_primary_height": 94.0,
        "left_shoulder_height": 42.0,
        "right_peak_y": 238.0,
        "right_primary_height": 82.0,
        "right_shoulder_height": 35.0,
        "rear_height": 124.0,
        "rear_peak_bias": -12.0,
        "erosion_strength": 1.02,
        "river_width_scale": 1.10,
        "meadow_width_scale": 1.16,
        "mountain_depth_shift": 8.0,
    },
}

REPLACED_REFERENCE_OBJECTS = {
    "BAR_V13_LEFT_MID",
    "BAR_V13_RIGHT_FOREGROUND",
    "FX_V13_WATER_RIPPLES",
    "MTN_V13_FAR_CENTRAL_RIDGE",
    "RIV_V13_EMERALD_S_WATER.001",
    "RIV_V13_VISIBLE_PEBBLE_BED.001",
    "TER_V13_FICTIONAL_NAGANO_MASSIF",
    "WEB_RIVERBANK_ROCKS_PLACED_00",
    "WEB_RIVERBANK_ROCKS_PLACED_01",
    "P2_FOREST_MID_CANOPY",
    "P2_RIDGE_FAR",
    "P2_RIDGE_MID",
    "P2_SHORE_WET_LEFT",
    "P2_SHORE_WET_RIGHT",
}

RETAINED_CAVE_TOKENS = (
    "CAVE_HQ_",
    "WEB_CAVE_HQ_",
)

SELECTED_OBJECT_NAMES = [
    "V3_HERO_MASSIF",
    "V3_LEFT_RIDGE",
    "V3_RIGHT_RIDGE",
    "V3_MIDGROUND_RIDGES",
    "V3_FAR_RIDGES",
    "V3_VALLEY_FLOOR",
    "V3_RIVERBED_PROXY",
    "V3_LEFT_RIVERBANK_PROXY",
    "V3_RIGHT_RIVERBANK_PROXY",
    "V3_MEADOW_BASE",
]
