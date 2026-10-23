"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import type { Recipe } from "@/lib/types";

type Mode = "closed" | "open" | "cook";

export default function Recipes({
  recipes,
  profileId,
  onChanged,
}: {
  recipes: Recipe[];
  profileId: string;
  onChanged: () => void;
}) {
  const [modes, setModes] = useState<Record<string, Mode>>({});
  const [have, setHave] = useState<Record<string, Set<string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setMode = (id: string, mode: Mode) =>
    setModes((current) => ({ ...current, [id]: mode }));

  const toggleHave = (recipeId: string, ingredientId: string) =>
    setHave((current) => {
      const set = new Set(current[recipeId] ?? []);
      if (set.has(ingredientId)) set.delete(ingredientId);
      else set.add(ingredientId);
      return { ...current, [recipeId]: set };
    });

  const push = async (recipe: Recipe, skip: string[] | null) => {
    setBusy(recipe.id);
    setError(null);
    setNote(null);
    try {
      const result = await api<{ count: number; recipeName: string }>(
        `/api/recipes/${recipe.id}/to-list`,
        { method: "POST", body: JSON.stringify({ have: skip ?? [] }), profileId },
      );
      setNote(
        `${result.count} ingredient${result.count === 1 ? "" : "s"} for ${result.recipeName} added to the list.`,
      );
      setMode(recipe.id, "closed");
      setHave((current) => ({ ...current, [recipe.id]: new Set() }));
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (recipe: Recipe) => {
    if (!window.confirm(`Delete ${recipe.name}?`)) return;
    try {
      await api(`/api/recipes/${recipe.id}`, { method: "DELETE", profileId });
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  if (recipes.length === 0) {
    return (
      <p className="empty">
        No recipes yet. Photograph a recipe card from the capture screen and it
        lands here, ingredients and all.
      </p>
    );
  }

  return (
    <>
      {note ? (
        <div className="banner" style={{
            borderColor: "rgba(74,122,65,0.35)",
            background: "#e9f2e6",
            color: "#2c4d26",
          }}>
          {note}
        </div>
      ) : null}
      {error ? <div className="banner">{error}</div> : null}

      {recipes.map((recipe) => {
        const mode = modes[recipe.id] ?? "closed";
        const owned = have[recipe.id] ?? new Set<string>();
        const remaining = recipe.ingredients.length - owned.size;

        return (
          <article className="recipe" key={recipe.id}>
            <button
              className="recipe__head"
              onClick={() => setMode(recipe.id, mode === "closed" ? "open" : "closed")}
              aria-expanded={mode !== "closed"}
            >
              <span>
                <span className="recipe__name">{recipe.name}</span>
                <span className="recipe__meta">
                  {" "}
                  · {recipe.ingredients.length} ingredients
                  {recipe.servings ? ` · ${recipe.servings}` : ""}
                </span>
              </span>
              <span className="recipe__meta">{mode === "closed" ? "▸" : "▾"}</span>
            </button>

            {mode !== "closed" ? (
              <div className="recipe__body">
                <div className="ingredients">
                  {recipe.ingredients.map((ingredient) => {
                    const ticked = owned.has(ingredient.id);
                    const cooking = mode === "cook";
                    return (
                      <button
                        key={ingredient.id}
                        className={`ingredient${ticked ? " ingredient--have" : ""}`}
                        onClick={() => cooking && toggleHave(recipe.id, ingredient.id)}
                        aria-pressed={cooking ? ticked : undefined}
                        disabled={!cooking}
                      >
                        <span className="check" aria-hidden="true" style={{ width: 20, height: 20 }}>
                          {ticked ? (
                            <svg width="12" height="12" viewBox="0 0 14 14">
                              <path
                                d="M2 7.5 5.5 11 12 3.5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.4"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          ) : null}
                        </span>
                        <span className="ingredient__name">
                          {[ingredient.quantity, ingredient.unit].filter(Boolean).join(" ")}{" "}
                          {ingredient.name}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {mode === "cook" ? (
                  <p className="recipe__meta">
                    Tick what you already have. {remaining} will go on the list.
                  </p>
                ) : null}

                {recipe.instructions && mode === "open" ? (
                  <div className="instructions">{recipe.instructions}</div>
                ) : null}

                <div className="recipe__actions">
                  {mode === "open" ? (
                    <>
                      <button
                        className="btn btn--primary"
                        disabled={busy === recipe.id}
                        onClick={() => void push(recipe, null)}
                      >
                        Add this recipe to the list
                      </button>
                      <button className="btn" onClick={() => setMode(recipe.id, "cook")}>
                        I&rsquo;m making this
                      </button>
                      <button className="btn btn--ghost btn--danger" onClick={() => void remove(recipe)}>
                        Delete
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="btn btn--primary"
                        disabled={busy === recipe.id || remaining === 0}
                        onClick={() => void push(recipe, [...owned])}
                      >
                        {remaining === 0
                          ? "You have everything"
                          : `Add the ${remaining} I don't have`}
                      </button>
                      <button className="btn btn--ghost" onClick={() => setMode(recipe.id, "open")}>
                        Back
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : null}
          </article>
        );
      })}
    </>
  );
}
