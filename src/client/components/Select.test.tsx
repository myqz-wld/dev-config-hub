import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Select } from "./Select.tsx";

describe("Select", () => {
  afterEach(() => cleanup());

  it("renders a portaled themed popover and commits an option", () => {
    const onChange = mock(() => {});
    const { getByRole } = render(
      <Select
        value="path"
        options={[
          { value: "path", label: "相对路径" },
          { value: "name", label: "文件名" },
        ]}
        onChange={onChange}
        ariaLabel="匹配对象"
        className="policy-select"
        popoverClassName="policy-select-popover"
        popoverMinWidth={164}
        portal
      />,
    );

    fireEvent.click(getByRole("button", { name: "匹配对象" }));
    const popover = document.body.querySelector(".policy-select-popover");
    expect(popover).toBeTruthy();
    expect(popover?.classList.contains("select-popover-portal")).toBe(true);
    expect((popover as HTMLElement).style.width).toBe("164px");

    const option = getByRole("option", { name: "文件名" });
    fireEvent.mouseDown(option);
    expect(onChange).toHaveBeenCalledWith("name");
    expect(document.body.querySelector(".policy-select-popover")).toBeNull();
  });

  it("closes a portaled popover when clicking outside", () => {
    const { getByRole } = render(
      <Select
        value="a"
        options={[{ value: "a", label: "A" }]}
        onChange={() => {}}
        ariaLabel="测试下拉"
        portal
      />,
    );

    fireEvent.click(getByRole("button", { name: "测试下拉" }));
    expect(document.body.querySelector(".select-popover-portal")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(document.body.querySelector(".select-popover-portal")).toBeNull();
  });
});
