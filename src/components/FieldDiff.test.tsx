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

describe("FieldDiff project field", () => {
  const projects = { prj_1: { name: "Mnemonis" } };

  it("labels the field as project and shows the name, No project for null and Unknown project for a dangling id", () => {
    render(<FieldDiff changes={[{ field: "projectId", before: null, after: "prj_1" }, { field: "projectId", before: "prj_gone", after: "prj_1" }]} projects={projects} />);
    expect(screen.getAllByText("project")).toHaveLength(2);
    expect(screen.getAllByText("Mnemonis")).toHaveLength(2);
    expect(screen.getByText("No project")).toBeInTheDocument();
    expect(screen.getByText("Unknown project")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/prj_/);
  });
});
