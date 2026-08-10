"""Art-direction parameters for Journey V3 Phase 1C.1 visual correction."""

CAMERA_SWEEP_PROGRESS = [11.5, 12.0, 13.5, 16.0, 20.0, 22.0, 23.5, 25.0, 28.25, 30.0]
CAVE_REVIEW_PROGRESS = [11.5, 13.5, 16.0, 20.0, 30.0]

ZONE_COLORS = {
    "ROCK": (0.38, 0.34, 0.31, 1.0),
    "GRASS": (0.30, 0.54, 0.16, 1.0),
    "FOREST": (0.045, 0.22, 0.09, 1.0),
    "SNOW": (0.88, 0.92, 0.95, 1.0),
    "WET": (0.10, 0.34, 0.29, 1.0),
    "FLOWER_POTENTIAL": (0.70, 0.20, 0.55, 1.0),
    "RIVER_EXCLUSION": (0.03, 0.42, 0.68, 1.0),
    "WIND_REACTIVE_VEGETATION": (0.90, 0.60, 0.10, 1.0),
}

CANDIDATES = {
    "A2": {
        "label": "Montfort-dominant asymmetric diagonal valley",
        "cycle": 3,
        "valley_near": 78.0,
        "valley_far": 30.0,
        "valley_bias": -12.0,
        "dominant_side": -1,
        "left": {
            "start_y": 62.0,
            "end_y": 354.0,
            "outer": 270.0,
            "base": 24.0,
            "ridge_center": 0.46,
            "ridge_width": 0.34,
            "peaks": [(104.0, 62.0, 44.0), (176.0, 124.0, 56.0), (260.0, 88.0, 62.0), (332.0, 48.0, 54.0)],
            "erosion": 1.05,
        },
        "right": {
            "start_y": 138.0,
            "end_y": 410.0,
            "outer": 248.0,
            "base": 16.0,
            "ridge_center": 0.53,
            "ridge_width": 0.40,
            "peaks": [(184.0, 40.0, 48.0), (262.0, 68.0, 58.0), (350.0, 48.0, 64.0)],
            "erosion": 0.72,
        },
        "river_centers": [18.0, 11.0, -2.0, -17.0, -29.0, -20.0, -5.0, 9.0, 4.0, -3.0],
        "river_width_scale": 1.00,
        "meadow_extent": 148.0,
        "far_scale": 1.00,
        "far_bias": 16.0,
    },
    "B2": {
        "label": "Hero Valley open mountain range",
        "cycle": 3,
        "valley_near": 104.0,
        "valley_far": 40.0,
        "valley_bias": 6.0,
        "dominant_side": 1,
        "left": {
            "start_y": 126.0,
            "end_y": 405.0,
            "outer": 272.0,
            "base": 15.0,
            "ridge_center": 0.52,
            "ridge_width": 0.42,
            "peaks": [(166.0, 38.0, 54.0), (246.0, 66.0, 64.0), (338.0, 52.0, 70.0)],
            "erosion": 0.68,
        },
        "right": {
            "start_y": 146.0,
            "end_y": 418.0,
            "outer": 268.0,
            "base": 14.0,
            "ridge_center": 0.48,
            "ridge_width": 0.43,
            "peaks": [(190.0, 42.0, 58.0), (276.0, 62.0, 68.0), (360.0, 44.0, 72.0)],
            "erosion": 0.64,
        },
        "river_centers": [-18.0, -9.0, 8.0, 23.0, 16.0, -5.0, -18.0, -4.0, 12.0, 5.0],
        "river_width_scale": 1.12,
        "meadow_extent": 174.0,
        "far_scale": 1.12,
        "far_bias": -6.0,
    },
    "V002": {
        "label": "Selected Hybrid v002: receded Montfort shoulder with open Hero Valley range",
        "cycle": 4,
        "valley_near": 98.0,
        "valley_far": 37.0,
        "valley_bias": -4.0,
        "dominant_side": -1,
        "left": {
            "start_y": 96.0,
            "end_y": 384.0,
            "outer": 282.0,
            "base": 18.0,
            "ridge_center": 0.50,
            "ridge_width": 0.42,
            "peaks": [(138.0, 48.0, 54.0), (214.0, 82.0, 68.0), (300.0, 64.0, 72.0), (366.0, 38.0, 58.0)],
            "erosion": 0.88,
        },
        "right": {
            "start_y": 154.0,
            "end_y": 432.0,
            "outer": 270.0,
            "base": 14.0,
            "ridge_center": 0.50,
            "ridge_width": 0.45,
            "peaks": [(204.0, 34.0, 58.0), (290.0, 55.0, 72.0), (380.0, 42.0, 76.0)],
            "erosion": 0.66,
        },
        "river_centers": [7.0, -8.0, -19.0, -2.0, 20.0, 27.0, 8.0, -15.0, -5.0, 6.0],
        "river_width_scale": 1.08,
        "meadow_extent": 168.0,
        "far_scale": 1.90,
        "far_bias": 4.0,
    },
}

RIVER_Y = [0.0, 26.0, 55.0, 88.0, 124.0, 166.0, 210.0, 256.0, 306.0, 360.0]
RIVER_HALF_WIDTH = [21.0, 19.0, 17.2, 15.4, 13.8, 12.0, 10.2, 8.4, 6.7, 5.2]
RIVER_BED_Z = [-2.1, -1.50, -0.82, -0.05, 0.82, 1.84, 3.02, 4.34, 5.82, 7.42]

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
    "P2_CLOUD_FAR",
}

RETAINED_STORY_TOKENS = ("CAVE_HQ_", "WEB_CAVE_HQ_")
