from pydantic import BaseModel


class BuyerEntry(BaseModel):
    name: str


class BuyerAssignmentListResponse(BaseModel):
    buyers: list[BuyerEntry]
