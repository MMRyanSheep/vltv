"""Train a LightGBM model for the probability that attackers win the round.

Load the saved model with lightgbm.Booster(model_file=...) and pass
prepare_features(snapshots) to Booster.predict. Defender win probability is
one minus the returned value.
"""

import argparse
from pathlib import Path
from tempfile import TemporaryDirectory

import lightgbm as lgb
import numpy as np
import pandas as pd


TRAINING_DIR = Path(__file__).resolve().parent
FEATURES = (
    "attackers_alive",
    "defenders_alive",
    "round_time_remaining",
    "spike_planted",
    "spike_time_remaining",
    "attackers_loadout_value",
    "defenders_loadout_value",
    "map_id",
    "plant_site",
    "round_number",
)
CATEGORICAL_FEATURES = ("map_id", "plant_site")
LABEL = "attacker_won"
MATCH_ID = "match_id"


def prepare_features(snapshots: pd.DataFrame) -> pd.DataFrame:
    features = snapshots.loc[:, list(FEATURES)].copy()
    for column in FEATURES:
        if column in CATEGORICAL_FEATURES:
            features[column] = features[column].astype("category")
        elif column == "spike_planted":
            flags = features[column].astype("string").str.strip().str.lower()
            planted = pd.to_numeric(flags.replace({"true": "1", "false": "0"}), errors="coerce")
            if (flags.notna() & ~planted.isin([0, 1])).any():
                raise ValueError("spike_planted must be true, false, 1, or 0")
            features[column] = planted.astype("float64")
        else:
            features[column] = pd.to_numeric(features[column]).astype("float64")
    return features


def read_dataset(path: Path) -> pd.DataFrame:
    rows = pd.read_csv(path, dtype={MATCH_ID: "string"})
    missing = set((*FEATURES, LABEL, MATCH_ID)) - set(rows.columns)
    if missing:
        raise ValueError(
            f"Missing columns: {', '.join(sorted(missing))}. "
            "Rebuild the CSV with training/build_dataset.py."
        )
    if not rows[LABEL].isin([0, 1]).all():
        raise ValueError("attacker_won must be 1 for an attacker win or 0 for a defender win")
    match_ids = rows[MATCH_ID].str.strip()
    if match_ids.isna().any() or match_ids.eq("").any():
        raise ValueError("Every row must have a match_id")
    rows[MATCH_ID] = match_ids
    return rows


def split_by_match(rows: pd.DataFrame, validation_fraction: float, seed: int):
    match_ids = sorted(rows[MATCH_ID].unique())
    if len(match_ids) < 2:
        raise ValueError("At least two matches are required for a match-level split")
    validation_count = min(len(match_ids) - 1, max(1, round(len(match_ids) * validation_fraction)))
    shuffled_ids = np.random.default_rng(seed).permutation(match_ids)
    validation = rows[MATCH_ID].isin(shuffled_ids[:validation_count])
    return rows.loc[~validation], rows.loc[validation]


def probability_metrics(labels, probabilities):
    clipped = np.clip(probabilities, 1e-15, 1 - 1e-15)
    log_loss = -np.mean(labels * np.log(clipped) + (1 - labels) * np.log1p(-clipped))
    brier = np.mean((probabilities - labels) ** 2)
    return log_loss, brier


def fit_model(rows, seed, rounds):
    train_data = lgb.Dataset(prepare_features(rows), label=rows[LABEL])
    return lgb.train(
        {
            "objective": "binary",
            "learning_rate": 0.05,
            "num_leaves": 15,
            "min_data_in_leaf": 30,
            "verbosity": -1,
            "num_threads": 4,
            "seed": seed,
            "deterministic": True,
            "force_col_wise": True,
        },
        train_data,
        num_boost_round=rounds,
    )


def train(dataset: Path, output: Path, validation_fraction: float, seed: int, rounds: int,
          *, refit: bool = False):
    rows = read_dataset(dataset)
    training, validation = split_by_match(rows, validation_fraction, seed)
    if training[LABEL].nunique() != 2:
        raise ValueError("Training matches must contain wins for both sides")

    model = fit_model(training, seed, rounds)
    probabilities = model.predict(prepare_features(validation), validate_features=True)
    labels = validation[LABEL].to_numpy()
    log_loss, brier = probability_metrics(labels, probabilities)
    baseline_loss, baseline_brier = probability_metrics(labels, training[LABEL].mean())

    print(f"Training: {len(training)} snapshots across {training[MATCH_ID].nunique()} matches")
    print(f"Validation: {len(validation)} snapshots across {validation[MATCH_ID].nunique()} matches")
    print(f"Validation log loss: {log_loss:.4f} (base rate: {baseline_loss:.4f})")
    print(f"Validation Brier score: {brier:.4f} (base rate: {baseline_brier:.4f})")
    if refit:
        model = fit_model(rows, seed, rounds)
        print(f"Final fit: {len(rows)} snapshots across {rows[MATCH_ID].nunique()} matches")

    output.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=output.parent) as temporary:
        model_file = Path(temporary) / output.name
        model.save_model(model_file)
        model_file.replace(output)
    print(f"Saved model to {output}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dataset", type=Path, default=TRAINING_DIR / "dataset.csv")
    parser.add_argument("--output", type=Path, default=TRAINING_DIR / "round_win_model.txt")
    parser.add_argument("--validation-fraction", type=float, default=0.25)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--rounds", type=int, default=120, help="number of boosting iterations")
    args = parser.parse_args()
    if not 0 < args.validation_fraction < 1:
        parser.error("--validation-fraction must be between 0 and 1")
    if not 0 <= args.seed < 2**31:
        parser.error("--seed must be a non-negative 32-bit signed integer")
    if args.rounds < 1:
        parser.error("--rounds must be positive")
    if args.dataset.resolve() == args.output.resolve():
        parser.error("--output must be different from --dataset")

    try:
        train(args.dataset, args.output, args.validation_fraction, args.seed, args.rounds)
    except (OSError, ValueError, lgb.basic.LightGBMError) as error:
        parser.exit(1, f"Could not train model: {error}\n")


if __name__ == "__main__":
    main()
