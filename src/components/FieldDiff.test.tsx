import { render, screen } from "@testing-library/react";
import { FieldDiff } from "./FieldDiff";

describe("FieldDiff collection field", () => {
  const collections = { c1: { name: "Finance" }, c2: { name: "Unsorted" } };

  it("labels the field as collection and shows names, not ids", () => {
    render(
      <FieldDiff changes={[{ field: "collectionId", before: "c2", after: "c1" }]} collections={collections} />,
    );
    expect(screen.getByText("collection")).toBeInTheDocument();
    expect(screen.getByText("Finance")).toBeInTheDocument();
    expect(screen.getByText("Unsorted")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bc1\b|\bc2\b/);
  });

  it("shows No collection for null and Unknown collection for a dangling id", () => {
    render(
      <FieldDiff changes={[{ field: "collectionId", before: null, after: "gone" }]} collections={collections} />,
    );
    expect(screen.getByText("No collection")).toBeInTheDocument();
    expect(screen.getByText("Unknown collection")).toBeInTheDocument();
  });
});
